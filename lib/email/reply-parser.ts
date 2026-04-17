/**
 * Inbound reply parser for Resend `email.received` webhooks.
 *
 * Resend delivers inbound mail in two steps:
 *   1. `email.received` webhook — metadata only (no body / no headers).
 *        Ref: https://www.resend.com/docs/webhooks/emails/received
 *   2. `resend.emails.receiving.get(email_id)` — returns `text`, `html`,
 *      and `headers` for the received message.
 *        Ref: https://www.resend.com/docs/api-reference/emails/retrieve-received-email
 *
 * This module is pure and synchronous: it takes an already-retrieved
 * `ResendReceivedEmail` and returns the caller-typed cleaned reply. It does
 * not perform any network calls, so it is trivially testable offline.
 */

// ─── Resend contract types ──────────────────────────────────────────────────

export interface ResendReceivedWebhook {
  type: "email.received";
  created_at: string;
  data: {
    email_id: string;
    created_at: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    message_id?: string;
    attachments?: ResendAttachmentRef[];
  };
}

export interface ResendAttachmentRef {
  id: string;
  filename: string;
  content_type: string;
  content_disposition: string | null;
  content_id: string | null;
}

/**
 * Shape returned by `GET /emails/receiving/:id` (a.k.a. `resend.emails.receiving.get`).
 * Headers arrive as a lowercased-key map in practice; callers should not rely on
 * any particular casing — `parseInboundReply` normalises internally.
 */
export interface ResendReceivedEmail {
  object: "email";
  id: string;
  to: string[];
  from: string;
  cc: string[];
  bcc: string[];
  reply_to: string[];
  subject: string;
  html: string | null;
  text: string | null;
  headers: Record<string, string>;
  message_id: string | null;
  created_at: string;
  raw?: { download_url: string; expires_at: string };
  attachments?: ResendAttachmentRef[];
}

export interface ParsedReply {
  /** What the sender actually typed in this message, with signature stripped. */
  cleanText: string;
  /** The prior messages they quoted, markers preserved. */
  quotedTrail: string;
  /** True if the message looks auto-generated (OOO, vacation, bounce, vendor bot). */
  isAutoReply: boolean;
  /** True if a signature block was detected and removed from `cleanText`. */
  signatureRemoved: boolean;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function parseInboundReply(email: ResendReceivedEmail): ParsedReply {
  const isAutoReply =
    detectAutoReplyFromHeaders(email.headers) ||
    detectAutoReplyFromSubject(email.subject);

  const body = pickBody(email);
  if (!body) {
    return { cleanText: "", quotedTrail: "", isAutoReply, signatureRemoved: false };
  }

  const normalized = body.replace(/\r\n/g, "\n");
  const { cleanText, quotedTrail } = splitReplyAndQuote(normalized);
  const { stripped, removed } = stripSignature(cleanText);

  return {
    cleanText: stripped.trim(),
    quotedTrail: quotedTrail.trim(),
    isAutoReply,
    signatureRemoved: removed,
  };
}

// ─── Body selection ─────────────────────────────────────────────────────────

function pickBody(email: ResendReceivedEmail): string {
  if (email.text && email.text.trim().length > 0) return email.text;
  if (email.html && email.html.trim().length > 0) return htmlToText(email.html);
  return "";
}

// ─── Quote / trail detection ────────────────────────────────────────────────

/**
 * Split the body at the boundary between the new reply and the quoted trail.
 * Tries every known client pattern and picks the earliest match, which is
 * correct because reply clients always put quoted history *below* the user's
 * new text.
 */
function splitReplyAndQuote(body: string): { cleanText: string; quotedTrail: string } {
  const candidates: number[] = [];

  const push = (m: RegExpMatchArray | null) => {
    if (!m || m.index === undefined) return;
    // If the match began with a leading "\n" we want the boundary to sit at
    // the line after the preceding content, not the newline itself.
    const leadingNewlines = /^\n+/.exec(m[0])?.[0].length ?? 0;
    candidates.push(m.index + leadingNewlines);
  };

  // Gmail / generic: `On <date>, <name> wrote:` attribution line.
  push(body.match(/\n[ \t]*On .{1,300}\bwrote:[ \t]*\n/));

  // Outlook desktop / web: `-----Original Message-----`.
  push(body.match(/\n-{3,}\s*Original Message\s*-{3,}[ \t]*\n/i));

  // Outlook Web: bare header block (no dashes) — From: / Sent: / To: / [Cc:] / Subject:.
  push(
    body.match(
      /\nFrom:[ \t].+\nSent:[ \t].+\nTo:[ \t].+\n(?:Cc:[ \t].*\n)?Subject:[ \t].+\n/
    )
  );

  // Apple Mail / plain-text: contiguous block of `>`-prefixed lines preceded
  // by a blank line. Anchoring to `\n\n` avoids false positives on inline `>`.
  const quoteBlock = body.match(/\n\n(> ?.*(?:\n> ?.*)*)/);
  if (quoteBlock?.index !== undefined) {
    candidates.push(quoteBlock.index + 2); // skip the "\n\n"
  }

  if (candidates.length === 0) {
    return { cleanText: body, quotedTrail: "" };
  }

  const boundary = Math.min(...candidates);
  return {
    cleanText: body.slice(0, boundary),
    quotedTrail: body.slice(boundary),
  };
}

// ─── Signature stripping ────────────────────────────────────────────────────

const MOBILE_FOOTERS: RegExp[] = [
  /\n[ \t]*Sent from my iPhone[^\n]*\s*$/i,
  /\n[ \t]*Sent from my iPad[^\n]*\s*$/i,
  /\n[ \t]*Sent from my (?:Samsung|Android|Google Pixel|Galaxy)[^\n]*\s*$/i,
  /\n[ \t]*Get Outlook for (?:iOS|Android)[^\n]*\s*$/i,
];

function stripSignature(text: string): { stripped: string; removed: boolean } {
  // RFC 3676 §4.3 signature delimiter: "-- " on its own line.
  // Match the trailing space strictly first; then fall back to the lenient
  // "--" form that many clients produce after whitespace-trimming.
  const rfc = text.match(/\n-- \n[\s\S]*$/) ?? text.match(/\n--\n[\s\S]*$/);
  if (rfc?.index !== undefined) {
    return { stripped: text.slice(0, rfc.index), removed: true };
  }

  for (const pat of MOBILE_FOOTERS) {
    if (pat.test(text)) {
      return { stripped: text.replace(pat, ""), removed: true };
    }
  }

  return { stripped: text, removed: false };
}

// ─── Auto-reply detection ───────────────────────────────────────────────────

function detectAutoReplyFromHeaders(headers: Record<string, string>): boolean {
  const h = lowerKeys(headers);

  const autoSubmitted = h["auto-submitted"]?.trim();
  if (autoSubmitted && /^(auto-replied|auto-generated)\b/i.test(autoSubmitted)) {
    return true;
  }

  const xAutoreply = h["x-autoreply"]?.trim();
  if (xAutoreply && /^yes\b/i.test(xAutoreply)) {
    return true;
  }

  const precedence = h["precedence"]?.trim();
  if (precedence && /^(auto_reply|bulk|junk)\b/i.test(precedence)) {
    return true;
  }

  return false;
}

function detectAutoReplyFromSubject(subject: string | null | undefined): boolean {
  if (!subject) return false;
  return /^(out of office\b|automatic reply\b|auto(?:matic)? reply\b)/i.test(subject.trim());
}

function lowerKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

// ─── HTML → plain text (minimal, scoped to quote/signature detection) ──────

/**
 * Produce a plaintext approximation of `html` that preserves the line
 * structure needed for downstream quote and signature detection.
 *
 * Deliberately narrow: handles the tags that affect line breaks
 * (`<br>`, `<p>`, `<div>`, `<blockquote>`, list items, table rows) and
 * decodes a small set of entities. Not a general-purpose HTML parser —
 * reach for a proper sanitizer if you need to render user HTML.
 */
export function htmlToText(html: string): string {
  let s = html;

  // Drop script/style blocks wholesale.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");

  // <blockquote> → lines prefixed with "> " so the generic quote detector
  // can split on it. Preserve inner <br> as newlines before stripping tags.
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner: string) => {
    const withBreaks = inner.replace(/<br\s*\/?>/gi, "\n");
    const textOnly = withBreaks.replace(/<[^>]+>/g, "");
    const quoted = textOnly
      .split("\n")
      .map((line) => "> " + line.trim())
      .join("\n");
    return "\n\n" + quoted + "\n";
  });

  // Line-breaking tags → newlines.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, "\n");
  s = s.replace(/<\/(?:ul|ol|table)>/gi, "\n");

  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, "");

  // Decode the handful of entities that show up in normal prose.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");

  // Collapse runs of blank lines that HTML churn can create.
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}
