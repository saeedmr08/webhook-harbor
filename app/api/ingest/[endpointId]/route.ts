import { NextResponse } from "next/server";
import { harborStore } from "@/lib/store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ endpointId: string }> };

/**
 * Ingest a webhook POST for a temporary endpoint.
 * Headers of interest:
 * - X-Harbor-Signature: HMAC-SHA256 hex (or sha256=<hex>)
 * - X-Harbor-Delivery-Id: unique delivery id (replay protection)
 * - X-Harbor-Org: optional workspace claim for tenant checks
 * - X-Harbor-Force-Fail: set to 1 to simulate upstream failure + retries
 */
export async function POST(request: Request, context: RouteContext) {
  const { endpointId } = await context.params;
  const endpoint = harborStore.getEndpoint(endpointId);
  if (!endpoint) {
    return NextResponse.json(
      { error: "Endpoint not found or expired" },
      { status: 404 }
    );
  }

  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  try {
    const { delivery, httpStatus } = harborStore.ingest({
      endpointId,
      rawBody,
      headers,
      method: "POST",
      path: `/api/ingest/${endpointId}`,
    });

    return NextResponse.json(
      {
        id: delivery.id,
        status: delivery.status,
        deliveryId: delivery.deliveryId,
        rejectReason: delivery.rejectReason ?? null,
        nextRetryAt: delivery.nextRetryAt,
      },
      { status: httpStatus }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ingest failed" },
      { status: 500 }
    );
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const { endpointId } = await context.params;
  const endpoint = harborStore.getEndpoint(endpointId);
  if (!endpoint) {
    return NextResponse.json(
      { error: "Endpoint not found or expired" },
      { status: 404 }
    );
  }
  return NextResponse.json({
    endpoint: harborStore.publicEndpoint(endpoint, false),
    deliveries: harborStore.listDeliveries({ endpointId }),
  });
}
