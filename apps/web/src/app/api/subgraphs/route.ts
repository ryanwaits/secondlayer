import { NextResponse } from "next/server";
import { apiRequest, ApiError, getSessionFromRequest } from "@/lib/api";

export async function GET(req: Request) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await apiRequest<{ data: unknown[] }>("/api/subgraphs", {
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
