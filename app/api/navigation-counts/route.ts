import { NextResponse } from "next/server";
import { getNavigationCounts } from "@/lib/navigation-counts";

export async function GET() {
  try {
    return NextResponse.json(await getNavigationCounts(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No s'han pogut obtenir els recomptes." }, { status: 500 });
  }
}
