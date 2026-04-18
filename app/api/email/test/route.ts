import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/agents/tools";
import { appendSignaturePlain, resolveSenderName } from "@/lib/email/signature";

export const runtime = "nodejs";

/**
 * POST /api/email/test — sends a single test message to the logged-in user's email.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "Email is not configured (RESEND_API_KEY)." },
      { status: 503 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const sender = resolveSenderName(
    (profile as { full_name?: string | null } | null)?.full_name
  );

  const main = [
    "Hi,",
    "",
    "If you're reading this, outbound email from SDR Jarvis is reaching your inbox.",
    "",
    "Next: import or discover leads, run the pipeline, and approve drafts before anything sends to prospects.",
  ].join("\n");

  const result = await sendEmail({
    to: user.email,
    subject: "SDR Jarvis — test email",
    body: appendSignaturePlain(main, sender),
  });

  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? "Failed to send test email" },
      { status: 502 }
    );
  }

  const service = createServiceClient();
  await service.from("audit_log").insert({
    user_id: user.id,
    action: "test_email_sent",
    resource_type: "user",
    resource_id: user.id,
    details: { message_id: result.messageId, to: user.email },
  });

  return NextResponse.json({ success: true, messageId: result.messageId });
}
