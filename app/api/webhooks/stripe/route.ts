import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Stripe webhooks are paused until billing is enabled." },
    { status: 501 }
  );
}
