/**
 * RFC 5322 / 2822 message-id generation, parsing, and threading helpers.
 *
 * Resend's `emails.send` resolved value returns only an internal Resend UUID
 * (`data.id`), NOT the on-the-wire RFC 822 `Message-ID` header. To make
 * inbound replies reliably match back to the outbound send, we generate our
 * own Message-Id, pass it through Resend's `headers` option, and store the
 * exact value we produced. The prospect's mail client then echoes it in
 * `In-Reply-To` / `References`, which the webhook uses to find the row.
 *
 * All functions in this module are pure and synchronous — trivially testable
 * offline.
 *
 * Ref:
 *   - RFC 5322 §3.6.4 (identification fields; References construction rule)
 *   - https://www.resend.com/docs/dashboard/receiving/reply-to-emails
 */

import { randomUUID } from "crypto";

/**
 * Canonical form for stored rfcMessageId values. Always bracket-wrapped
 * (`<id@domain>`) and whitespace-trimmed. The webhook matcher compares
 * against the exact value in this form.
 */
export function canonicalizeMessageId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed;
  return `<${trimmed.replace(/^</, "").replace(/>$/, "")}>`;
}

/**
 * Parse a domain out of a `from` string that may be plain (`x@domain`) or a
 * display-name form (`"Name <x@domain>"`). Falls back to `"localhost"` only
 * if nothing parseable is found — callers should pass a configured value.
 */
export function extractSenderDomain(fromEmail: string | undefined): string {
  if (!fromEmail) return "localhost";
  const angle = fromEmail.match(/<([^>]+)>/);
  const address = angle ? angle[1] : fromEmail;
  const at = address.lastIndexOf("@");
  if (at < 0) return "localhost";
  return address.slice(at + 1).trim() || "localhost";
}

/**
 * Generate a fresh RFC 822 Message-Id of the form `<uuid@domain>`, bracket-
 * wrapped and ready to be written both to Resend's headers option and to
 * `interactions.metadata.rfcMessageId`.
 */
export function generateRfcMessageId(domain: string): string {
  const safeDomain = domain?.trim() || "localhost";
  return `<${randomUUID()}@${safeDomain}>`;
}

/**
 * Extract candidate RFC 822 Message-Ids from an inbound email's headers.
 * Reads `In-Reply-To` (single id) and `References` (space-separated list),
 * trims each token, drops empties, and deduplicates while preserving order
 * (In-Reply-To first, then References left-to-right). The matcher queries
 * each candidate in turn, so dedup avoids wasted round-trips.
 *
 * Header lookup is case-insensitive.
 */
export function extractCandidateIds(
  headers: Record<string, string> | undefined
): string[] {
  if (!headers) return [];
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string | undefined) => {
    if (!raw) return;
    const token = raw.trim();
    if (!token) return;
    if (seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };

  push(lower["in-reply-to"]);

  const references = lower["references"];
  if (references) {
    for (const token of references.split(/\s+/)) push(token);
  }

  return out;
}

/**
 * Build the `References` header for an outbound reply, per RFC 5322 §3.6.4.
 *
 * The canonical rule is: the child's References = parent's References +
 * parent's Message-Id. Here the "parent" is the inbound email we are
 * replying to.
 *
 * @param priorReferences - The inbound email's `References` header, either
 *   raw (space-separated string) or already tokenised. May be omitted when
 *   the inbound carried no References (i.e. it was the first message in the
 *   thread) — in that case References collapses to just the inbound's id.
 * @param inboundMessageId - The RFC 822 Message-Id of the message we're
 *   replying to. Required.
 *
 * Duplicates are removed while preserving the left-to-right order of the
 * prior chain, and the inbound id is always appended at the end so clients
 * show the new reply at the tail of the thread.
 */
export function buildReferences(
  priorReferences: string | string[] | undefined,
  inboundMessageId: string
): string {
  const target = inboundMessageId.trim();
  if (!target) return "";

  const tokens =
    typeof priorReferences === "string"
      ? priorReferences.split(/\s+/)
      : priorReferences ?? [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens) {
    const t = raw.trim();
    if (!t || t === target) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  out.push(target);
  return out.join(" ");
}

/**
 * Compute the threading headers for an outbound reply given the context of
 * the inbound we are replying to. Pure — returns the exact header map that
 * should be passed to Resend's `headers` option (in addition to `Message-Id`).
 *
 * Returns an empty object when `inboundMessageId` is falsy so callers can
 * spread the result safely.
 */
export function buildThreadHeaders(ctx: {
  inboundMessageId: string | null | undefined;
  inboundReferences?: string | string[] | null | undefined;
}): { "In-Reply-To"?: string; References?: string } {
  if (!ctx.inboundMessageId) return {};
  const inReplyTo = ctx.inboundMessageId.trim();
  if (!inReplyTo) return {};
  const references = buildReferences(
    ctx.inboundReferences ?? undefined,
    inReplyTo
  );
  return { "In-Reply-To": inReplyTo, References: references };
}
