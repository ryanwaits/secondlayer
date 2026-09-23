import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

/**
 * Stripe Checkout for the signed-in account. No email field: the session
 * decides which account the credits land on, so they can't go astray.
 */
export async function POST(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	const body = (await req.json().catch(() => ({}))) as { amount?: unknown };
	try {
		const { url } = await apiRequest<{ url: string }>("/api/billing/topup", {
			method: "POST",
			body: { amount: Number(body.amount) },
			sessionToken,
		});
		return NextResponse.json({ url });
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
