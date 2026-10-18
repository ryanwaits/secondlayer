import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

type Prefs = {
	webhookFailing: boolean;
	subgraphStopped: boolean;
	subgraphNotServing: boolean;
	replayDone: boolean;
	spendCap: boolean;
	keyRepeat: boolean;
};

function failure(e: unknown) {
	if (e instanceof ApiError) {
		return NextResponse.json({ error: e.message }, { status: e.status });
	}
	return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

/** The signed-in account's push toggles plus the server's VAPID public key. */
export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	try {
		return NextResponse.json(
			await apiRequest<{ publicKey: string | null; prefs: Prefs }>(
				"/api/push/prefs",
				{ sessionToken },
			),
		);
	} catch (e) {
		return failure(e);
	}
}

export async function PUT(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	const body = (await req.json().catch(() => ({}))) as Partial<Prefs>;
	try {
		return NextResponse.json(
			await apiRequest<Prefs>("/api/push/prefs", {
				method: "PUT",
				body,
				sessionToken,
			}),
		);
	} catch (e) {
		return failure(e);
	}
}
