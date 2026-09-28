import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

type Caps = {
	monthlyCapCents: number | null;
	alertThresholdPct: number;
	frozenAt: string | null;
	alertSentAt: string | null;
};

/** The signed-in account's monthly spend-cap setting. */
export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	try {
		const caps = await apiRequest<Caps>("/api/billing/caps", {
			sessionToken,
		});
		return NextResponse.json(caps);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}

export async function PATCH(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	const body = (await req.json().catch(() => ({}))) as {
		monthlyCapCents?: unknown;
		alertThresholdPct?: unknown;
	};
	try {
		const caps = await apiRequest<Caps>("/api/billing/caps", {
			method: "PATCH",
			body,
			sessionToken,
		});
		return NextResponse.json(caps);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
