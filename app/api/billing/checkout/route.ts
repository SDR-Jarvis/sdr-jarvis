import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Billing is not enabled yet. Coming soon." },
    { status: 501 }
  );
}
