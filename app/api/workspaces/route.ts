import { NextResponse } from "next/server";
import { harborStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  harborStore.ensureDemoWorkspace();
  return NextResponse.json({ workspaces: harborStore.listWorkspaces() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const ws = harborStore.createWorkspace(body.name ?? "New Quay");
  return NextResponse.json({ workspace: ws }, { status: 201 });
}
