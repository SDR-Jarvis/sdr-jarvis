/**
 * Outbound email signature — plain text stored in DB; HTML built at send time.
 * Marker prevents duplicate "Best," blocks without brittle full-string equality.
 */
export const EMAIL_SIGNATURE_MARKER = "\u2060sdrj-sig\u2060";

/** Remove internal idempotency marker before HTML conversion / send. */
export function stripSignatureMarkerForSend(body: string): string {
  return body.split(EMAIL_SIGNATURE_MARKER).join("");
}

const BEST_SIG_RE = /(^|\n)\s*Best\s*,?\s*(\n|$)/i;

export function resolveSenderName(fullName: string | null | undefined): string {
  const t = (fullName ?? "").trim();
  return t.length > 0 ? t : "Founder";
}

export function bodyHasJarvisSignatureMarker(body: string): boolean {
  return body.includes(EMAIL_SIGNATURE_MARKER);
}

/** Heuristic: closing "Best," / name block near end (avoid false positives in long copy). */
export function hasLikelyClosingSignature(body: string): boolean {
  if (bodyHasJarvisSignatureMarker(body)) return true;
  const tail = body.slice(-800);
  if (!BEST_SIG_RE.test(tail)) return false;
  const afterBest = tail.split(/\n\s*Best\s*,?\s*\n/i).pop() ?? "";
  const lines = afterBest
    .trim()
    .split(/\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  const firstLine = lines[0].trim();
  if (firstLine.length > 80) return false;
  return true;
}

/**
 * Append plain-text signature after main content (before compliance footer).
 * Idempotent if marker or heuristic already matches.
 */
export function appendSignaturePlain(body: string, senderName: string): string {
  const name = resolveSenderName(senderName);
  const trimmed = body.trimEnd();
  if (bodyHasJarvisSignatureMarker(trimmed) || hasLikelyClosingSignature(trimmed)) {
    return body;
  }
  const block = `\n\nBest,\n${name}\n${EMAIL_SIGNATURE_MARKER}`;
  return `${trimmed}${block}`;
}
