import { NextResponse } from "next/server";
import { apiRequest, ApiError, getSessionFromRequest } from "@/lib/api";
import type { AbiContract } from "@secondlayer/stacks/clarity";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ contractId: string[] }> },
) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { contractId } = await params;
  const id = contractId.join("/");

  try {
    const data = await apiRequest<{ abi: AbiContract }>(
      `/api/node/contracts/${id}/abi`,
      { sessionToken },
    );
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
