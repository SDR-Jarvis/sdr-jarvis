import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Send } from "lucide-react";
import { PRODUCT_TAGLINE } from "@/lib/product-copy";
import { CampaignListClient } from "./campaign-list-client";

export default async function CampaignsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-jarvis-blue/80">{PRODUCT_TAGLINE}</p>
          <h1 className="mt-0.5 text-2xl font-bold text-white">Campaigns</h1>
          <p className="mt-1 text-sm text-jarvis-muted">
            {campaigns?.length
              ? `${campaigns.length} workspace${campaigns.length > 1 ? "s" : ""} for your outbound`
              : "Create a campaign, add leads, then run the pipeline to get drafts for approval."}
          </p>
        </div>
        <Link href="/dashboard/campaigns/new" className="jarvis-btn-primary">
          <Plus className="h-4 w-4" />
          New Campaign
        </Link>
      </div>

      {!campaigns?.length ? (
        <div className="jarvis-card flex flex-col items-center justify-center py-16 text-center">
          <Send className="mb-4 h-10 w-10 text-jarvis-blue/30" />
          <h3 className="text-lg font-semibold text-white">Your first campaign</h3>
          <p className="mt-2 max-w-md text-sm text-jarvis-muted">
            One place for a batch of leads and their emails. Jarvis researches and drafts — you approve before anything
            sends.
          </p>
          <Link href="/dashboard/campaigns/new" className="jarvis-btn-primary mt-6">
            <Plus className="h-4 w-4" />
            Create Campaign
          </Link>
        </div>
      ) : (
        <CampaignListClient initialCampaigns={campaigns} />
      )}
    </div>
  );
}
