"use client";

import Link from "next/link";
import { Zap, Compass } from "lucide-react";
import { TestEmailButton } from "./test-email-button";

export function QuickStartBanner({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-jarvis-blue/25 bg-jarvis-blue/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-white">Quick start (2 minutes)</p>
        <p className="mt-0.5 text-xs text-jarvis-muted">
          Send yourself a test email, then discover or import leads and run a campaign.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TestEmailButton compact />
        <Link
          href="/dashboard/leads/discover"
          className="inline-flex items-center gap-1.5 rounded-md border border-jarvis-border px-3 py-1.5 text-xs font-medium text-jarvis-muted transition-colors hover:border-jarvis-blue/30 hover:text-white"
        >
          <Compass className="h-3.5 w-3.5" />
          Discover
        </Link>
        <Link
          href="/dashboard/campaigns/new"
          className="inline-flex items-center gap-1.5 rounded-md border border-jarvis-border px-3 py-1.5 text-xs font-medium text-jarvis-muted transition-colors hover:border-jarvis-blue/30 hover:text-white"
        >
          <Zap className="h-3.5 w-3.5" />
          New campaign
        </Link>
      </div>
    </div>
  );
}
