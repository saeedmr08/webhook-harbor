import { NextResponse } from "next/server";
import { harborStore } from "@/lib/store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Replay a stored delivery (creates a new inspected copy). */
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const delivery = harborStore.replayDelivery(id);
    return NextResponse.json({ delivery }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Replay failed" },
      { status: 404 }
    );
  }
}
