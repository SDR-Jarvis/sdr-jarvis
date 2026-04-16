import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Admin dashboard access: DB flag and/or comma-separated ADMIN_BOOTSTRAP_EMAILS (server env).
 * Remove bootstrap list once is_admin is set in Supabase for your account.
 */
export async function userHasAdminAccess(
  supabase: SupabaseClient,
  userId: string,
  email: string | undefined
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .single();

  if (profile?.is_admin === true) return true;

  const bootstrap = (process.env.ADMIN_BOOTSTRAP_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (email && bootstrap.includes(email.toLowerCase())) return true;

  return false;
}
