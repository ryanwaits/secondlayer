import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { apiRequest, ApiError, getSessionFromRequest } from "@/lib/api";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await params;

  try {
    const data = await apiRequest(`/api/views/${name}`, { sessionToken });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await params;

  try {
    const data = await apiRequest<{ message: string }>(
      `/api/views/${name}`,
      { method: "DELETE", sessionToken },
    );
    revalidateTag("views", { expire: 0 });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
