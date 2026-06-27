"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Send,
  Users,
  CheckCircle,
  MessageSquare,
  BarChart3,
  Settings,
  Zap,
  LogOut,
  Upload,
  Shield,
  Menu,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Send },
  { href: "/dashboard/leads", label: "Leads", icon: Users },
  { href: "/dashboard/leads/import", label: "Import Leads", icon: Upload },
  { href: "/dashboard/approvals", label: "Approvals", icon: CheckCircle },
  { href: "/dashboard/replies", label: "Replies", icon: MessageSquare },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (error) {
        console.error("[Profile Read] Error:", error.message);
      }
      setIsAdmin(profile?.is_admin === true);
    });
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = mobileNavOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

  async function handleSignOut() {
    setMobileNavOpen(false);
    await supabase.auth.signOut();
    router.push("/");
  }

  const closeNav = () => setMobileNavOpen(false);

  return (
    <div className="flex min-h-dvh bg-jarvis-dark">
      {/* Mobile top bar — sidebar is off-canvas; main uses full width */}
      <header className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-jarvis-border bg-jarvis-surface/95 px-4 backdrop-blur md:hidden">
        <Link
          href="/dashboard"
          className="flex min-w-0 items-center gap-2"
          onClick={closeNav}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-jarvis-blue/30 bg-jarvis-blue/10 arc-reactor">
            <Zap className="h-4 w-4 text-jarvis-blue" />
          </div>
          <span className="truncate text-base font-bold tracking-tight text-white">
            SDR Jarvis
          </span>
        </Link>
        <button
          type="button"
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setMobileNavOpen((o) => !o)}
          className="shrink-0 rounded-md p-2 text-jarvis-muted transition-colors hover:bg-white/5 hover:text-white"
        >
          {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={closeNav}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(18rem,100vw)] flex-col border-r border-jarvis-border bg-jarvis-surface transition-transform duration-200 ease-out md:static md:z-10 md:w-64 md:translate-x-0 md:transition-none",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-jarvis-border px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-jarvis-blue/30 bg-jarvis-blue/10 arc-reactor">
            <Zap className="h-4 w-4 text-jarvis-blue" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">SDR Jarvis</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeNav}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-jarvis-blue/10 text-jarvis-blue"
                    : "text-jarvis-muted hover:bg-white/5 hover:text-white"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-jarvis-border px-3 py-4">
          {isAdmin && (
            <Link
              href="/dashboard/admin"
              onClick={closeNav}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname === "/dashboard/admin"
                  ? "bg-jarvis-gold/10 text-jarvis-gold"
                  : "text-jarvis-gold/60 hover:bg-white/5 hover:text-jarvis-gold"
              )}
            >
              <Shield className="h-4 w-4 shrink-0" />
              Admin
            </Link>
          )}
          <Link
            href="/dashboard/settings"
            onClick={closeNav}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-jarvis-muted transition-colors hover:bg-white/5 hover:text-white"
          >
            <Settings className="h-4 w-4 shrink-0" />
            Settings
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-jarvis-muted transition-colors hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
          <p className="px-3 pt-2 text-[10px] text-jarvis-muted/40">v0.1.0 — MVP</p>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-14 md:pt-0">
        <div className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
