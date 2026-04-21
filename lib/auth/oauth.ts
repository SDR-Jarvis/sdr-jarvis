"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { getFriendlyAuthError } from "@/lib/auth/error-messages";

export type OAuthProvider = "google" | "github" | "linkedin_oidc";

export async function signInWithGoogle() {
  const supabase = createClientComponentClient();
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
}

export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
  if (provider === "google") {
    return signInWithGoogle();
  }
  const supabase = createClientComponentClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      scopes: provider === "linkedin_oidc" ? "openid profile email" : undefined,
    },
  });
  if (error) {
    throw new Error(getFriendlyAuthError(error.message));
  }
}
