import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Billing is paused until after launch. Coming soon." },
    { status: 501 }
  );
}
