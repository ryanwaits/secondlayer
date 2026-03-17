import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { apiRequest, ApiError, getSessionFromRequest } from "@/lib/api";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const data = await apiRequest<{ revoked: boolean; id: string }>(
      `/api/keys/${id}`,
      { method: "DELETE", sessionToken },
    );
    revalidateTag("keys", { expire: 0 });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
