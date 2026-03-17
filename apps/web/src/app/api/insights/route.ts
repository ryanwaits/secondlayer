import { NextResponse } from "next/server";
import { apiRequest, ApiError, getSessionFromRequest } from "@/lib/api";

export async function GET(req: Request) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const data = await apiRequest(`/api/insights${qs ? `?${qs}` : ""}`, {
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
