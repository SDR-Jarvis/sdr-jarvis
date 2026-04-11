import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/agents/tools";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/replies/action
 *
 * Handles user actions on qualified replies:
 * - send_reply: Send a custom reply email
 * - book_meeting: Mark as meeting booked (calendar integration TBD)
 * - follow_up_later: Set lead for future follow-up
 * - archive: Archive the lead
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
  const { replyId, leadId, action, replySubject, replyBody } = body as {
    replyId: string;
    leadId: string;
    action: "send_reply" | "book_meeting" | "follow_up_later" | "archive";
    replySubject?: string;
    replyBody?: string;
  };

  if (!replyId || !leadId || !action) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  logger.setUser(user.id);

  switch (action) {
    case "send_reply": {
      if (!replyBody?.trim()) {
        return NextResponse.json({ error: "Reply body is required" }, { status: 400 });
      }

      const { data: lead } = await supabase
        .from("leads")
        .select("email, first_name, last_name, campaign_id")
        .eq("id", leadId)
        .single();

      if (!lead?.email) {
        return NextResponse.json({ error: "No email address for this lead" }, { status: 400 });
      }

      const result = await sendEmail({
        to: lead.email,
        subject: replySubject ?? "Re: Following up",
        body: replyBody,
      });

      if (result.success) {
        await serviceClient.from("interactions").insert({
          lead_id: leadId,
          campaign_id: lead.campaign_id,
          user_id: user.id,
          type: "email_outbound",
          status: "sent",
          subject: replySubject,
          body: replyBody,
          metadata: { messageId: result.messageId, is_reply_to: replyId },
          sent_at: new Date().toISOString(),
        });

        await serviceClient
          .from("leads")
          .update({ status: "qualified", last_contacted_at: new Date().toISOString() })
          .eq("id", leadId);

        await serviceClient.from("audit_log").insert({
          user_id: user.id,
          action: "reply_sent",
          resource_type: "lead",
          resource_id: leadId,
          details: {
            to: lead.email,
            subject: replySubject,
            lead_name: `${lead.first_name} ${lead.last_name}`,
          },
        });

        logger.success("replies", `Reply sent to ${lead.email}`);
      }

      return NextResponse.json({ success: result.success, error: result.error });
    }

    case "book_meeting": {
      await serviceClient
        .from("leads")
        .update({ status: "meeting_booked" })
        .eq("id", leadId);

      await serviceClient.from("audit_log").insert({
        user_id: user.id,
        action: "meeting_booked",
        resource_type: "lead",
        resource_id: leadId,
      });

      logger.success("replies", `Meeting booked for lead ${leadId}`);
      return NextResponse.json({ success: true });
    }

    case "follow_up_later": {
      await serviceClient
        .from("leads")
        .update({ status: "replied" })
        .eq("id", leadId);

      await serviceClient.from("audit_log").insert({
        user_id: user.id,
        action: "follow_up_scheduled",
        resource_type: "lead",
        resource_id: leadId,
      });

      return NextResponse.json({ success: true });
    }

    case "archive": {
      await serviceClient
        .from("leads")
        .update({ status: "archived" })
        .eq("id", leadId);

      await serviceClient.from("audit_log").insert({
        user_id: user.id,
        action: "lead_archived",
        resource_type: "lead",
        resource_id: leadId,
      });

      return NextResponse.json({ success: true });
    }

    default:
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
}
