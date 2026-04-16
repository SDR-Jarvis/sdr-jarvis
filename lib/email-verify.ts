/**
 * Optional NeverBounce (or compatible) verification — set NEVERBOUNCE_API_KEY to enable.
 * https://developers.neverbounce.com/docs/v4-single-check
 */

export type VerifyResult = "valid" | "invalid" | "unknown";

export async function verifyEmailIfConfigured(
  email: string
): Promise<VerifyResult> {
  const apiKey = process.env.NEVERBOUNCE_API_KEY;
  if (!apiKey || !email.includes("@")) return "unknown";

  try {
    const res = await fetch("https://api.neverbounce.com/v4/single/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: apiKey, email: email.trim() }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { result?: string };
    const r = (data.result ?? "").toLowerCase();
    if (r === "valid" || r === "catchall") return "valid";
    if (r === "invalid" || r === "disposable") return "invalid";
    return "unknown";
  } catch {
    return "unknown";
  }
}
