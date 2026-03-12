import { NextResponse } from "next/server";
import { apiRequest, ApiError, getSessionFromRequest } from "@/lib/api";
import type { Account } from "@/lib/types";

export async function GET(req: Request) {
  const sessionToken = getSessionFromRequest(req);
  if (!sessionToken) {
    return NextResponse.json({ account: null });
  }

  try {
    const account = await apiRequest<Account>("/api/accounts/me", {
      sessionToken,
    });
    return NextResponse.json({ account });
  } catch (e) {
    // Session expired or invalid — clear the cookie
    const res = NextResponse.json({ account: null });
    if (e instanceof ApiError && e.status === 401) {
      res.cookies.set("sl_session", "", { maxAge: 0, path: "/" });
    }
    return res;
  }
}
