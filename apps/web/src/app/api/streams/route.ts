import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { apiRequest, ApiError, getSessionFromRequest } from "@/lib/api";

export async function GET(req: Request) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const limit = url.searchParams.get("limit") || "20";
    const offset = url.searchParams.get("offset") || "0";
    const data = await apiRequest(`/api/streams?limit=${limit}&offset=${offset}`, {
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

export async function POST(req: Request) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const data = await apiRequest("/api/streams", {
      method: "POST",
      body,
      sessionToken,
    });
    revalidateTag("streams", { expire: 0 });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
