/**
 * Fetch the full content of an inbound email from Resend.
 *
 * Resend's `email.received` webhook carries metadata only. The body,
 * headers, and attachment contents must be retrieved via the Received
 * Emails API. We call it directly rather than through the SDK so this
 * file doesn't depend on the minor version of `resend`.
 *
 * Ref: https://www.resend.com/docs/api-reference/emails/retrieve-received-email
 */

import type { ResendReceivedEmail } from "./reply-parser";

const RESEND_API_BASE = "https://api.resend.com";

export class ResendReceivingError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ResendReceivingError";
  }
}

export async function fetchReceivedEmail(emailId: string): Promise<ResendReceivedEmail> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new ResendReceivingError("RESEND_API_KEY is not configured");
  }

  const res = await fetch(`${RESEND_API_BASE}/emails/receiving/${emailId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    // Short timeout so a stuck API call can't pin the webhook handler.
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ResendReceivingError(
      `Received email fetch failed: ${res.status} ${res.statusText} ${body}`.trim(),
      res.status
    );
  }

  return (await res.json()) as ResendReceivedEmail;
}
