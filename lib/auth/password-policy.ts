/**
 * Client-side rules aligned with Supabase Auth when "strong password" / character
 * requirements are enabled in the project dashboard. Prevents confusing failures
 * where the UI only mentioned length.
 */

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordChecklist = {
  minLength: boolean;
  lowercase: boolean;
  uppercase: boolean;
  digit: boolean;
  symbol: boolean;
};

export function evaluatePassword(password: string): PasswordChecklist {
  return {
    minLength: password.length >= PASSWORD_MIN_LENGTH,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    digit: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
}

export function passwordMeetsPolicy(c: PasswordChecklist): boolean {
  return (
    c.minLength &&
    c.lowercase &&
    c.uppercase &&
    c.digit &&
    c.symbol
  );
}

/** Short message for inline validation before hitting the API. */
export function passwordPolicyHint(c: PasswordChecklist): string | null {
  if (passwordMeetsPolicy(c)) return null;
  const missing: string[] = [];
  if (!c.minLength) missing.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
  if (!c.lowercase) missing.push("one lowercase letter");
  if (!c.uppercase) missing.push("one uppercase letter");
  if (!c.digit) missing.push("one number");
  if (!c.symbol) missing.push("one symbol (e.g. ! @ # $)");
  return `Add ${missing.join(", ")}.`;
}

/**
 * Supabase / GoTrue sometimes returns long technical strings; keep a calm headline.
 */
export function friendlyAuthPasswordError(raw: string): string {
  const t = raw.trim();
  if (/password.*character.*each/i.test(t) || /should contain/i.test(t)) {
    return "Your password needs every type listed below (length, upper & lower case, number, and a symbol).";
  }
  if (/password.*least.*\d+/i.test(t) || /too short/i.test(t)) {
    return "That password is too short for your account settings.";
  }
  if (/password.*common/i.test(t) || /pwned|leaked|breach/i.test(t)) {
    return "That password is too common or has appeared in a breach. Pick something more unique.";
  }
  return t;
}
