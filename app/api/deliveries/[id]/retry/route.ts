import { NextResponse } from "next/server";
import { harborStore } from "@/lib/store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Advance retry/backoff simulation for a failed delivery. */
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const delivery = harborStore.simulateRetry(id);
    return NextResponse.json({ delivery });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Retry failed" },
      { status: 400 }
    );
  }
}
