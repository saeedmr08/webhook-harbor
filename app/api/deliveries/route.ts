import { NextResponse } from "next/server";
import { harborStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId") ?? undefined;
  const endpointId = searchParams.get("endpointId") ?? undefined;
  const deliveries = harborStore.listDeliveries({ workspaceId, endpointId });
  return NextResponse.json({ deliveries });
}
