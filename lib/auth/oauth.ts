"use client";

import { createClient } from "@/lib/supabase/client";
import { getFriendlyAuthError } from "@/lib/auth/error-messages";

export type OAuthProvider = "google" | "github" | "linkedin_oidc";

/**
 * OAuth PKCE stores a short-lived verifier in cookies on the origin that starts sign-in.
 * The callback must run on that same origin — do not send users to NEXT_PUBLIC_APP_URL
 * if they are browsing another host (e.g. localhost vs production), or exchange fails.
 */
function redirectUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/callback`;
  }
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/auth/callback`;
}

export async function signInWithGoogle() {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl(),
    },
  });
  if (error) {
    throw new Error(getFriendlyAuthError(error.message));
  }
}

export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
  if (provider === "google") {
    return signInWithGoogle();
  }
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: redirectUrl(),
      scopes:
        provider === "linkedin_oidc" ? "openid profile email" : undefined,
    },
  });
  if (error) {
    throw new Error(getFriendlyAuthError(error.message));
  }
}
