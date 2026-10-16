import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import type { RowsResponse } from "@/lib/rows";
import { NextResponse } from "next/server";

/** Rows delivered for the signed-in account: the free allowance, rows per
 *  day and source, rows-per-call sizes and the account's own errors. */
export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	try {
		const data = await apiRequest<RowsResponse>("/api/billing/rows", {
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
