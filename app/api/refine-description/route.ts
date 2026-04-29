import { NextRequest, NextResponse } from "next/server";
import { createLLMClient } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

const REFINE_PRODUCT_PROMPT = `
A founder gave this brief description of their product:
"{SHORT_INPUT}"

Expand it into a rich 30-50 word description that includes:
- Who it's for (specific customer type)
- What it does (specific capability)
- Why it's different (key benefit or specific feature)

Write naturally, like a founder describing their own product.
Don't use marketing fluff like "innovative" or "cutting-edge".

Return ONLY the description, no preamble, no quotes, no markdown.
`.trim();

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    type?: string;
    shortInput?: string;
  };

  const type = body.type;
  const shortInput =
    typeof body.shortInput === "string" ? body.shortInput.trim() : "";

  if (type !== "product") {
    return NextResponse.json(
      { error: "type must be 'product'" },
      { status: 400 }
    );
  }

  if (!shortInput) {
    return NextResponse.json(
      { error: "shortInput is required" },
      { status: 400 }
    );
  }

  try {
    const llm = createLLMClient({ temperature: 0.4, maxTokens: 280 });
    const prompt = REFINE_PRODUCT_PROMPT.replace("{SHORT_INPUT}", shortInput);

    const response = await llm.invoke([
      {
        role: "system",
        content:
          "Return ONLY plain text. No JSON. No quotes. No markdown. No preamble.",
      },
      { role: "user", content: prompt },
    ]);

    const raw =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Defensive cleanup: strip wrapping quotes/backticks.
    const refined = raw
      .trim()
      .replace(/^["'`]+/, "")
      .replace(/["'`]+$/, "")
      .trim();

    return NextResponse.json({ refined });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

