import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export type AccountUpdates = {
	email: string | null;
	status: "none" | "pending" | "confirmed" | "unsubscribed";
	token: string | null;
};

/** The signed-in account's place on the updates list. */
export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	try {
		return NextResponse.json(
			await apiRequest<AccountUpdates>("/api/accounts/me/updates", {
				sessionToken,
			}),
		);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
