import { NextResponse } from "next/server";
import { apiRequest, ApiError, getSessionFromRequest } from "@/lib/api";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const url = new URL(req.url);
    const limit = url.searchParams.get("limit") || "50";
    const offset = url.searchParams.get("offset") || "0";
    const status = url.searchParams.get("status") || "";
    const qs = `limit=${limit}&offset=${offset}${status ? `&status=${status}` : ""}`;
    const data = await apiRequest(`/api/streams/${id}/deliveries?${qs}`, {
      sessionToken,
    });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
