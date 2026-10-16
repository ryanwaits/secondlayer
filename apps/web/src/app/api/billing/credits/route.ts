import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import type { CreditAdded } from "@/lib/types";
import { NextResponse } from "next/server";

/** The signed-in account's latest top-ups and grants, newest first. */
export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	try {
		const data = await apiRequest<{ credits: CreditAdded[] }>(
			"/api/billing/credits",
			{ sessionToken },
		);
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
