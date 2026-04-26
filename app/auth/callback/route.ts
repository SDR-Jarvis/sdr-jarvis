import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "protonmail.com",
  "aol.com",
]);

function inferCompanyFromDomain(email: string | null | undefined): string | null {
  const domain = email?.split("@")[1]?.toLowerCase().trim();
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) return null;
  const root = domain
    .replace(/\.(com|io|ai|co|net|org)$/i, "")
    .split(".")[0]
    ?.trim();
  if (!root) return null;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextRaw = searchParams.get("next") ?? "";
  const next = nextRaw.startsWith("/") ? nextRaw : "/dashboard";

  if (code) {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // ignore when called from a context that cannot set cookies
            }
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.redirect(`${origin}${next || "/dashboard"}`);
      }

      const oauthData = (user.user_metadata ?? {}) as Record<string, unknown>;
      console.log("[Auth Callback] OAuth metadata:", oauthData);
      const inferredCompany = inferCompanyFromDomain(user.email);
      const inferredName =
        (oauthData.full_name as string | undefined) ??
        (oauthData.name as string | undefined) ??
        user.email?.split("@")[0]?.replace(/[._]/g, " ") ??
        null;
      const normalizedName = inferredName?.trim() || null;
      const signoff = normalizedName?.split(/\s+/)[0] ?? null;

      const { data: existingProfile } = await supabase
        .from("profiles")
        .select(
          "full_name, company_name, avatar_url, timezone, tone_preferences, compliance_opt_out_line"
        )
        .eq("id", user.id)
        .maybeSingle();

      const existing = (existingProfile ?? {}) as {
        full_name?: string | null;
        company_name?: string | null;
        avatar_url?: string | null;
        timezone?: string | null;
        tone_preferences?: Record<string, unknown> | null;
        compliance_opt_out_line?: string | null;
      };

      const patch: Record<string, unknown> = {};
      if (!existing.full_name && normalizedName) patch.full_name = normalizedName;
      if (!existing.company_name && inferredCompany) patch.company_name = inferredCompany;
      if (!existing.avatar_url && typeof oauthData.avatar_url === "string") {
        patch.avatar_url = oauthData.avatar_url;
      }
      if (!existing.timezone) patch.timezone = "America/Los_Angeles";
      if (!existing.tone_preferences) {
        patch.tone_preferences = {
          formality: "professional-casual",
          humor: true,
          signoff,
        };
      }
      if (!existing.compliance_opt_out_line) {
        patch.compliance_opt_out_line = "Reply 'no thanks' if not relevant.";
      }

      if (Object.keys(patch).length > 0) {
        const { error: profileUpdateError } = await supabase
          .from("profiles")
          .update(patch)
          .eq("id", user.id);
        if (profileUpdateError) {
          console.error("[auth/callback] profile hydrate failed:", profileUpdateError.message);
        }
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarded")
        .eq("id", user.id)
        .maybeSingle();

      const redirectTo =
        profile?.onboarded === false ? "/onboarding/product" : "/dashboard";
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }

    console.error("[auth/callback] exchangeCodeForSession:", error.message);
  }

  return NextResponse.redirect(`${origin}/?error=oauth_failed`);
}
