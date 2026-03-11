import { NextResponse } from "next/server";
import { apiRequest, ApiError, getSessionFromRequest } from "@/lib/api";

export async function POST(req: Request) {
  try {
    const sessionToken = getSessionFromRequest(req);
    if (sessionToken) {
      await apiRequest("/api/auth/logout", {
        method: "POST",
        sessionToken,
      });
    }

    const res = NextResponse.json({ ok: true });
    res.headers.set(
      "Set-Cookie",
      "sl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    return res;
  } catch (e) {
    // Clear cookie even on error
    const res = NextResponse.json(
      { error: e instanceof ApiError ? e.message : "Internal error" },
      { status: e instanceof ApiError ? e.status : 500 },
    );
    res.headers.set(
      "Set-Cookie",
      "sl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    return res;
  }
}
