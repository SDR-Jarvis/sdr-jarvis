import { friendlyAuthPasswordError } from "@/lib/auth/password-policy";

const AUTH_ERROR_MAP: Record<string, string> = {
  "password should be at least": "Your password needs at least 8 characters.",
  "password should contain at least one uppercase":
    "Add one uppercase letter to your password.",
  "password should contain at least one number": "Add one number to your password.",
  "password should contain at least one special":
    "Add a special character — like !, @, or #.",
  "user already registered":
    "An account with this email already exists. Try signing in instead.",
  "invalid login credentials": "Wrong email or password. Please try again.",
  "invalid email or password": "Wrong email or password. Please try again.",
  "email not confirmed":
    "Check your email and click the confirmation link we sent you.",
  "too many requests": "Too many attempts. Wait a minute and try again.",
  "weak password": "Choose a stronger password.",
  "email address is invalid": "Enter a valid email address.",
  "token has expired": "This link has expired. Request a new one.",
  "same password": "Choose a different password from your current one.",
  "signups not allowed": "New accounts are not open right now. Try signing in instead.",
};

const FORBIDDEN_TERMS = [
  "supabase",
  "dashboard",
  "authentication",
  "provider",
  "postgres",
  "sql",
  "rls",
  "migration",
  "admin",
  "api key",
  "webhook",
  "resend",
  "vercel",
  "cron",
  ".env",
  "env var",
  "jwt",
  "row level",
  "gotrue",
  "oauth",
];

/**
 * Maps auth provider errors to calm, user-safe copy. Never leaks infra terms.
 */
export function getFriendlyAuthError(raw: string | null | undefined): string {
  if (!raw?.trim()) return "Something went wrong. Please try again.";

  const lower = raw.toLowerCase();

  if (FORBIDDEN_TERMS.some((term) => lower.includes(term))) {
    return "Something went wrong. Please try again.";
  }

  for (const [pattern, message] of Object.entries(AUTH_ERROR_MAP)) {
    if (lower.includes(pattern)) return message;
  }

  if (/password|credential|sign up|signup/i.test(raw)) {
    const pw = friendlyAuthPasswordError(raw);
    if (pw && !FORBIDDEN_TERMS.some((t) => pw.toLowerCase().includes(t))) {
      return pw;
    }
  }

  return "Something went wrong. Please try again.";
}
