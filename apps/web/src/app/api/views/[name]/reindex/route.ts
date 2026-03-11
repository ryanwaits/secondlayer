import { NextResponse } from "next/server";
import { apiRequest, ApiError, getSessionFromRequest } from "@/lib/api";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const data = await apiRequest<{ message: string; fromBlock?: number; toBlock?: number }>(
      `/api/views/${name}/reindex`,
      { method: "POST", body, sessionToken },
    );
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
