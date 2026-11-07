import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import type { Account } from "@/lib/types";
import { NextResponse } from "next/server";

// Next to the API, so each dashboard read and write takes the short hop.
export const preferredRegion = "fra1";

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
		// The API is down or timing out: that says nothing about the session,
		// so the browser must not read it as signed out. Only an answer from
		// the API counts as one.
		if (!(e instanceof ApiError) || e.status >= 500) {
			return NextResponse.json({ error: "unreachable" }, { status: 503 });
		}
		// Session expired or invalid — clear the cookie
		const res = NextResponse.json({ account: null });
		if (e.status === 401) {
			// Domain must match the set cookie to override it across subdomains.
			res.cookies.set("sl_session", "", {
				maxAge: 0,
				path: "/",
				domain: process.env.SESSION_COOKIE_DOMAIN,
			});
		}
		return res;
	}
}
