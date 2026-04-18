/** Default opt-out when profile row has not been customized yet (migration also sets DB default). */
export const DEFAULT_EMAIL_OPT_OUT_FOOTER =
  'If this isn\'t relevant, reply "no thanks" and I won\'t follow up again.';

export function normalizeOptOutLine(line: string | null | undefined): string {
  const t = (line ?? "").trim();
  return t.length > 0 ? t : DEFAULT_EMAIL_OPT_OUT_FOOTER;
}

/**
 * Block appended after the message body (mandatory for outbound).
 * Do not let the LLM invent legal text — we control this block.
 */
export function buildComplianceEmailSuffix(opts: {
  optOutLine: string;
  postalAddress?: string | null;
}): string {
  const opt = normalizeOptOutLine(opts.optOutLine);
  const parts = ["---", opt];
  const addr = opts.postalAddress?.trim();
  if (addr) parts.push(addr);
  return `\n\n${parts.join("\n")}`;
}

/** If edited body is missing the opt-out line, append full compliance block before send. */
export function ensureComplianceInBody(
  body: string,
  opts: { optOutLine: string; postalAddress?: string | null }
): string {
  const opt = normalizeOptOutLine(opts.optOutLine);
  if (body.includes(opt.slice(0, Math.min(20, opt.length)))) {
    return body;
  }
  return `${body.trimEnd()}${buildComplianceEmailSuffix(opts)}`;
}

/** Split body into main + compliance when our standard `---` block is present. */
export function splitMainAndComplianceBlock(body: string): {
  main: string;
  compliance: string | null;
} {
  const idx = body.indexOf("\n\n---\n");
  if (idx === -1) return { main: body, compliance: null };
  return {
    main: body.slice(0, idx),
    compliance: body.slice(idx),
  };
}
