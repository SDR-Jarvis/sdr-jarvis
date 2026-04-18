/**
 * Load the threading context for an outbound reply.
 *
 * When a user replies to a qualified inbound via `/api/replies/action` (or
 * when the auto-reply path in `/api/replies/log` fires), we need the
 * inbound's RFC 822 `Message-Id` and its `References` header so our outgoing
 * email carries `In-Reply-To` + `References` the prospect's mail client will
 * thread on. Those values are cached on the `email_reply` interaction row
 * at inbound time by the qualifier.
 *
 * For rows inserted before that caching shipped (or when the inbound
 * arrived without a usable `message_id`), we fall back to Resend's Received
 * Emails API using the stored `resendEmailId`. If both sources fail we
 * return `null` so the caller can log a warning and ship a best-effort
 * email without threading headers — never block the user-initiated reply.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { fetchReceivedEmail, ResendReceivingError } from "@/lib/email/resend-receiving";

export interface ThreadContext {
  inboundMessageId: string;
  inboundReferences?: string;
  /** Which source supplied the values — useful for diagnostics. */
  source: "cached" | "resend_api";
}

interface EmailReplyMetadata {
  inboundMessageId?: string;
  inboundReferences?: string;
  resendEmailId?: string;
  [key: string]: unknown;
}

/**
 * Resolve the threading context for a given `email_reply` interaction.
 *
 * Strategy:
 *   1. Read `metadata.{inboundMessageId, inboundReferences}` off the row.
 *   2. If missing but `metadata.resendEmailId` is present, re-fetch the
 *      inbound from Resend's Received Emails API and use its
 *      `message_id` / `headers.references`.
 *   3. Otherwise return `null` and let the caller fall through.
 *
 * The Supabase client is injected to keep this function unit-testable.
 */
export async function loadReplyThreadContext(
  supabase: SupabaseClient,
  emailReplyInteractionId: string
): Promise<ThreadContext | null> {
  const { data, error } = await supabase
    .from("interactions")
    .select("metadata")
    .eq("id", emailReplyInteractionId)
    .maybeSingle();

  if (error) {
    logger.warn("thread", `Failed to load reply interaction: ${error.message}`);
    return null;
  }
  if (!data) return null;

  const meta = (data.metadata ?? {}) as EmailReplyMetadata;

  if (meta.inboundMessageId) {
    return {
      inboundMessageId: meta.inboundMessageId,
      inboundReferences: meta.inboundReferences,
      source: "cached",
    };
  }

  if (meta.resendEmailId) {
    try {
      const email = await fetchReceivedEmail(meta.resendEmailId);
      const headerRefs =
        email.headers?.["references"] ??
        email.headers?.["References"] ??
        undefined;
      const messageId =
        email.message_id ??
        email.headers?.["message-id"] ??
        email.headers?.["Message-ID"] ??
        undefined;

      if (!messageId) {
        logger.warn(
          "thread",
          `Resend receiving API had no message_id for ${meta.resendEmailId}`
        );
        return null;
      }

      return {
        inboundMessageId: messageId,
        inboundReferences: headerRefs,
        source: "resend_api",
      };
    } catch (err) {
      const msg =
        err instanceof ResendReceivingError
          ? `${err.status ?? "?"} ${err.message}`
          : err instanceof Error
          ? err.message
          : String(err);
      logger.warn("thread", `Resend fallback failed: ${msg}`);
      return null;
    }
  }

  return null;
}
