import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as Record<string, unknown>)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const onDashboard = pathname.startsWith("/dashboard");
  const onOnboarding = pathname.startsWith("/onboarding");

  // Redirect unauthenticated users away from private routes.
  if (!user && (onDashboard || onOnboarding)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarded")
      .eq("id", user.id)
      .maybeSingle();

    const needsOnboarding = profile?.onboarded === false;

    if (needsOnboarding && (pathname === "/" || onDashboard)) {
      return NextResponse.redirect(new URL("/onboarding/product", request.url));
    }

    if (!needsOnboarding && onOnboarding) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    // Redirect authenticated users from login to the right home.
    if (pathname === "/") {
      return NextResponse.redirect(
        new URL(needsOnboarding ? "/onboarding/product" : "/dashboard", request.url)
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
