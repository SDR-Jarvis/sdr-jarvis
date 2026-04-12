import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { qualifyReply } from "@/lib/agents/nodes/qualifier";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/replies/log
 *
 * Manually log a reply from a prospect and trigger the Qualifier agent.
 * Body: { leadId, replyContent }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { leadId, replyContent } = body as {
    leadId: string;
    replyContent: string;
  };

  if (!leadId || !replyContent?.trim()) {
    return NextResponse.json({ error: "Lead ID and reply content are required" }, { status: 400 });
  }

  logger.setUser(user.id);

  const { data: lead } = await supabase
    .from("leads")
    .select("first_name, last_name, email, title, company, campaign_id")
    .eq("id", leadId)
    .eq("user_id", user.id)
    .single();

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const serviceClient = createServiceClient();

  // Find the most recent outbound interaction for this lead
  const { data: lastOutbound } = await serviceClient
    .from("interactions")
    .select("id, subject, body, campaign_id")
    .eq("lead_id", leadId)
    .eq("type", "email_outbound")
    .in("status", ["sent", "delivered"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const originalSubject = lastOutbound?.subject ?? "";
  const originalBody = lastOutbound?.body ?? "";
  const campaignId = lead.campaign_id;
  const leadName = `${lead.first_name} ${lead.last_name}`;

  logger.step("replies", `Manually logging reply from ${leadName}`);

  // Update lead status
  await serviceClient
    .from("leads")
    .update({ status: "replied" })
    .eq("id", leadId);

  // Update the outbound interaction status
  if (lastOutbound) {
    await serviceClient
      .from("interactions")
      .update({ status: "replied", replied_at: new Date().toISOString() })
      .eq("id", lastOutbound.id);
  }

  // Run the Qualifier agent
  const qualification = await qualifyReply({
    interactionId: lastOutbound?.id ?? leadId,
    leadId,
    campaignId,
    userId: user.id,
    replyContent,
    originalSubject,
    originalBody,
    leadName,
    leadTitle: lead.title,
    leadCompany: lead.company,
  });

  return NextResponse.json({
    success: true,
    qualification: qualification
      ? {
          interestLevel: qualification.interestLevel,
          intent: qualification.intent,
          suggestedAction: qualification.suggestedAction,
          confidence: qualification.confidence,
        }
      : null,
  });
}
