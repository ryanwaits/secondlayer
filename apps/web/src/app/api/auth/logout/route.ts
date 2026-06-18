import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

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
		// Domain must match the set cookie or the browser won't clear it.
		const cookieDomain = process.env.SESSION_COOKIE_DOMAIN;
		res.headers.set(
			"Set-Cookie",
			[
				"sl_session=",
				"Path=/",
				"HttpOnly",
				"SameSite=Lax",
				"Max-Age=0",
				...(cookieDomain ? [`Domain=${cookieDomain}`] : []),
			].join("; "),
		);
		return res;
	} catch (e) {
		// Clear cookie even on error
		const res = NextResponse.json(
			{ error: e instanceof ApiError ? e.message : "Internal error" },
			{ status: e instanceof ApiError ? e.status : 500 },
		);
		// Domain must match the set cookie or the browser won't clear it.
		const cookieDomain = process.env.SESSION_COOKIE_DOMAIN;
		res.headers.set(
			"Set-Cookie",
			[
				"sl_session=",
				"Path=/",
				"HttpOnly",
				"SameSite=Lax",
				"Max-Age=0",
				...(cookieDomain ? [`Domain=${cookieDomain}`] : []),
			].join("; "),
		);
		return res;
	}
}
