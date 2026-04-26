"use client";

import { useSearchParams } from "next/navigation";

export function OnboardingWelcomeBanner() {
  const searchParams = useSearchParams();
  if (searchParams.get("welcome") !== "onboarding") return null;
  return (
    <div className="rounded-lg border border-jarvis-success/40 bg-jarvis-success/10 px-4 py-3 text-sm text-jarvis-success">
      You&apos;re set up. Run discovery anytime to find more leads.
    </div>
  );
}
