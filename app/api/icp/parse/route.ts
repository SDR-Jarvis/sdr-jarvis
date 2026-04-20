import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractICPWithLLM } from "@/lib/icp/llm-extract";

export const runtime = "nodejs";

/**
 * POST /api/icp/parse — LLM fallback for ambiguous ICP text (authenticated).
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
  const description = typeof body.description === "string" ? body.description : "";
  if (!description.trim()) {
    return NextResponse.json({ error: "description required" }, { status: 400 });
  }

  const signals = await extractICPWithLLM(description.trim());
  return NextResponse.json(signals);
}
