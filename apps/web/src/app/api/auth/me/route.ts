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
    if (e instanceof ApiError && e.status === 401) {
      return NextResponse.json({ account: null });
    }
    return NextResponse.json({ account: null });
  }
}
