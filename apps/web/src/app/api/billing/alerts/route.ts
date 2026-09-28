import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

type Alerts = { notify7d: boolean; notify2d: boolean };

/** The signed-in account's balance-runway email preferences. */
export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	try {
		const alerts = await apiRequest<Alerts>("/api/billing/alerts", {
			sessionToken,
		});
		return NextResponse.json(alerts);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}

export async function PUT(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	const body = (await req.json().catch(() => ({}))) as {
		notify7d?: unknown;
		notify2d?: unknown;
	};
	try {
		const alerts = await apiRequest<Alerts>("/api/billing/alerts", {
			method: "PUT",
			body,
			sessionToken,
		});
		return NextResponse.json(alerts);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
