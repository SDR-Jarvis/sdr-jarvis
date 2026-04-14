"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import {
  CheckCircle,
  Circle,
  User,
  Building2,
  Upload,
  Zap,
  Globe,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Mail,
} from "lucide-react";

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: React.ElementType;
  check: (data: ChecklistData) => boolean;
}

interface ChecklistData {
  hasTestEmail: boolean;
  hasProfile: boolean;
  hasIcp: boolean;
  hasCampaign: boolean;
  hasLeads: boolean;
  hasRun: boolean;
  hasDomain: boolean;
}

const CHECKLIST: ChecklistItem[] = [
  {
    id: "test_email",
    label: "Send a test email",
    description: "Confirm mail reaches your inbox (Settings → Email delivery).",
    href: "/dashboard/settings?tab=profile#test-email",
    icon: Mail,
    check: (d) => d.hasTestEmail,
  },
  {
    id: "profile",
    label: "Set up your profile",
    description: "Name, company, and role — used in signatures and context.",
    href: "/dashboard/settings",
    icon: User,
    check: (d) => d.hasProfile,
  },
  {
    id: "icp",
    label: "Define your ideal customer",
    description: "Who you sell to — Jarvis uses this to score and angle outreach.",
    href: "/dashboard/settings",
    icon: Building2,
    check: (d) => d.hasIcp,
  },
  {
    id: "campaign",
    label: "Create your first campaign",
    description: "Set up a campaign with your ICP criteria and outreach sequence.",
    href: "/dashboard/campaigns/new",
    icon: Zap,
    check: (d) => d.hasCampaign,
  },
  {
    id: "leads",
    label: "Import or discover leads",
    description: "CSV import or Discover — you need emails to run outreach.",
    href: "/dashboard/leads/import",
    icon: Upload,
    check: (d) => d.hasLeads,
  },
  {
    id: "run",
    label: "Run your first pipeline",
    description: "Let Jarvis research prospects and draft personalized outreach.",
    href: "/dashboard/campaigns",
    icon: Sparkles,
    check: (d) => d.hasRun,
  },
  {
    id: "domain",
    label: "Set up a sending domain",
    description: "Move beyond sandbox — send from your own professional domain.",
    href: "/dashboard/settings",
    icon: Globe,
    check: (d) => d.hasDomain,
  },
];

export function OnboardingChecklist() {
  const supabase = createClient();
  const [data, setData] = useState<ChecklistData | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [domainDismissed, setDomainDismissed] = useState(false);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const [profileRes, campaignRes, leadsRes, runsRes, sentRes, testEmailRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, company_name, icp_description")
          .eq("id", user.id)
          .single(),
        supabase
          .from("campaigns")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("agent_runs")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("interactions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "sent"),
        supabase
          .from("audit_log")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("action", "test_email_sent"),
      ]);

      const profile = profileRes.data;
      const dismissed = localStorage.getItem("jarvis_domain_done") === "1";
      setDomainDismissed(dismissed);
      const hasDomain = dismissed || (sentRes.count ?? 0) > 0;
      setData({
        hasTestEmail: (testEmailRes.count ?? 0) > 0,
        hasProfile: !!(profile?.full_name && profile?.company_name),
        hasIcp: !!profile?.icp_description,
        hasCampaign: (campaignRes.count ?? 0) > 0,
        hasLeads: (leadsRes.count ?? 0) > 0,
        hasRun: (runsRes.count ?? 0) > 0,
        hasDomain,
      });
    }
    load();
  }, []);

  if (!data) return null;

  const completedCount = CHECKLIST.filter((item) => item.check(data)).length;
  const totalCount = CHECKLIST.length;
  const percentage = Math.round((completedCount / totalCount) * 100);
  const allDone = completedCount === totalCount;

  if (allDone) return null;

  return (
    <div className="jarvis-card border-jarvis-blue/20">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10">
            <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-jarvis-border"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <path
                className="text-jarvis-blue"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeDasharray={`${percentage}, 100`}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-jarvis-blue">
              {completedCount}/{totalCount}
            </span>
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-white">Get Started with Jarvis</h3>
            <p className="text-xs text-jarvis-muted">
              {completedCount === 0
                ? "Complete these steps to start closing deals."
                : `${totalCount - completedCount} step${totalCount - completedCount > 1 ? "s" : ""} remaining.`}
            </p>
          </div>
        </div>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 text-jarvis-muted" />
        ) : (
          <ChevronUp className="h-4 w-4 text-jarvis-muted" />
        )}
      </button>

      {!collapsed && (
        <div className="mt-4 space-y-1">
          {CHECKLIST.map((item) => {
            const done = item.check(data);
            const Icon = item.icon;
            return (
              <div key={item.id} className="flex items-center gap-0">
                <Link
                  href={item.href}
                  className={`flex flex-1 items-center gap-3 rounded-md px-3 py-2.5 transition-colors ${
                    done
                      ? "opacity-50"
                      : "hover:bg-white/[0.03]"
                  }`}
                >
                  {done ? (
                    <CheckCircle className="h-5 w-5 shrink-0 text-jarvis-success" />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-jarvis-border" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${done ? "text-jarvis-muted line-through" : "text-white"}`}>
                      {item.label}
                    </p>
                    <p className="text-xs text-jarvis-muted/60 truncate">
                      {item.description}
                    </p>
                  </div>
                  <Icon className="h-4 w-4 shrink-0 text-jarvis-muted/30" />
                </Link>
                {item.id === "domain" && !done && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      localStorage.setItem("jarvis_domain_done", "1");
                      setDomainDismissed(true);
                      setData((prev) => prev ? { ...prev, hasDomain: true } : prev);
                    }}
                    className="shrink-0 rounded-md px-2 py-1 text-[10px] font-medium text-jarvis-blue hover:bg-jarvis-blue/10 transition-colors"
                  >
                    Already done
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
