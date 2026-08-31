import { NextResponse } from "next/server";
import { harborStore } from "@/lib/store";

export const runtime = "nodejs";

/** List endpoints for a workspace (query: workspaceId). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let workspaceId = searchParams.get("workspaceId") ?? undefined;

  if (!workspaceId) {
    const ws = harborStore.ensureDemoWorkspace();
    workspaceId = ws.id;
  }

  const endpoints = harborStore
    .listEndpoints(workspaceId)
    .map((ep) => harborStore.publicEndpoint(ep, false));

  return NextResponse.json({ workspaceId, endpoints });
}

/** Create a temporary webhook endpoint (berth). */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      label?: string;
      secret?: string;
      workspaceName?: string;
    };

    let workspaceId = body.workspaceId;
    if (!workspaceId) {
      const ws = harborStore.ensureDemoWorkspace(
        body.workspaceName ?? "Default Quay"
      );
      workspaceId = ws.id;
    } else if (!harborStore.getWorkspace(workspaceId)) {
      return NextResponse.json(
        { error: "Unknown workspace" },
        { status: 404 }
      );
    }

    const endpoint = harborStore.createEndpoint({
      workspaceId,
      label: body.label,
      secret: body.secret,
    });

    return NextResponse.json(
      {
        endpoint: harborStore.publicEndpoint(endpoint, true),
        tip: "Store the secret now — it is only returned at creation and lives in memory.",
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 400 }
    );
  }
}
