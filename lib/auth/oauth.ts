"use client";

import { createClient } from "@/lib/supabase/client";
import { getFriendlyAuthError } from "@/lib/auth/error-messages";

export type OAuthProvider = "google" | "github" | "linkedin_oidc";

function redirectUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  if (typeof window !== "undefined" && !base) {
    return `${window.location.origin}/auth/callback`;
  }
  return `${base || (typeof window !== "undefined" ? window.location.origin : "")}/auth/callback`;
}

export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
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
