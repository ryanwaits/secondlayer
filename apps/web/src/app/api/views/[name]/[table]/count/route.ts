import { NextResponse } from "next/server";
import { apiRequest, ApiError, getSessionFromRequest } from "@/lib/api";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string; table: string }> },
) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, table } = await params;

  try {
    const data = await apiRequest<{ count: number }>(
      `/api/views/${name}/${table}/count`,
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
