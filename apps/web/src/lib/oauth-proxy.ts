import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { isSameOrigin } from "@/lib/same-origin";
import { NextResponse } from "next/server";

/**
 * The hosted-MCP sign-in routes (`/api/oauth/*`) forward to the API with the
 * session cookie as the bearer. The API accepts a session only. A write must
 * also come from this site's own pages: the cookie rides along on a
 * cross-site POST, so it alone proves nothing about who asked.
 */
export async function proxyOauth(
	req: Request,
	path: string,
	method: "GET" | "POST" | "DELETE",
): Promise<NextResponse> {
	if (method !== "GET" && !isSameOrigin(req)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	try {
		const data = await apiRequest<unknown>(path, {
			method,
			...(method === "POST" ? { body: {} } : {}),
			sessionToken,
		});
		return NextResponse.json(data, {
			headers: { "Cache-Control": "no-store" },
		});
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
