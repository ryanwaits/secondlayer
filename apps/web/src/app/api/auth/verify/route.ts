import { ApiError, apiRequest } from "@/lib/api";
import { crossSiteRefusal } from "@/lib/same-origin";
import type { Account } from "@/lib/types";
import { NextResponse } from "next/server";

// Next to the API, so each dashboard read and write takes the short hop.
export const preferredRegion = "fra1";

export async function POST(req: Request) {
	const refused = crossSiteRefusal(req);
	if (refused) return refused;
	if (
		!req.headers
			.get("content-type")
			?.toLowerCase()
			.startsWith("application/json")
	) {
		return NextResponse.json(
			{ error: "Content-Type must be application/json" },
			{ status: 415, headers: { "Cache-Control": "no-store" } },
		);
	}
	try {
		const body = await req.json();
		const data = await apiRequest<{ sessionToken: string; account: Account }>(
			"/api/auth/verify",
			{ method: "POST", body },
		);

		const { sessionToken, account } = data;

		const isProduction = process.env.NODE_ENV === "production";
		const cookieDomain = process.env.SESSION_COOKIE_DOMAIN;
		const cookie = [
			`sl_session=${sessionToken}`,
			"Path=/",
			"HttpOnly",
			"SameSite=Lax",
			"Max-Age=7776000",
			// Shared across subdomains (app.* + marketing root) when configured.
			...(cookieDomain ? [`Domain=${cookieDomain}`] : []),
			...(isProduction ? ["Secure"] : []),
		].join("; ");

		const res = NextResponse.json({ account });
		res.headers.set("Set-Cookie", cookie);
		return res;
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
