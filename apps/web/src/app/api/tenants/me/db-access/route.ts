import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

/**
 * Proxy: fetch the SSH-tunnel + DATABASE_URL template for the active
 * instance. Does not add or rotate the user's pubkey — see `./key/route.ts`
 * for that.
 */
export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	try {
		const data = await apiRequest("/api/tenants/me/db-access", {
			sessionToken,
		});
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
