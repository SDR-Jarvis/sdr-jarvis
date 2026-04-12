"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  Compass,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Send },
  { href: "/dashboard/leads", label: "Leads", icon: Users },
  { href: "/dashboard/leads/discover", label: "Discover", icon: Compass },
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

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <div className="flex h-screen bg-jarvis-dark">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-jarvis-border bg-jarvis-surface">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-jarvis-border px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-jarvis-blue/30 bg-jarvis-blue/10 arc-reactor">
            <Zap className="h-4 w-4 text-jarvis-blue" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">
            SDR Jarvis
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-jarvis-blue/10 text-jarvis-blue"
                    : "text-jarvis-muted hover:bg-white/5 hover:text-white"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="space-y-1 border-t border-jarvis-border px-3 py-4">
          <Link
            href="/dashboard/settings"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-jarvis-muted hover:bg-white/5 hover:text-white transition-colors"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-jarvis-muted hover:bg-white/5 hover:text-white transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
          <p className="px-3 pt-2 text-[10px] text-jarvis-muted/40">
            v0.1.0 — MVP
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
