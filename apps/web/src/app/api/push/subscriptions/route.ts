import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

function failure(e: unknown) {
	if (e instanceof ApiError) {
		return NextResponse.json({ error: e.message }, { status: e.status });
	}
	return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

/** Registers this browser for the signed-in account's push. */
export async function POST(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	const body = await req.json().catch(() => ({}));
	try {
		return NextResponse.json(
			await apiRequest<{ ok: true }>("/api/push/subscriptions", {
				method: "POST",
				body,
				sessionToken,
			}),
		);
	} catch (e) {
		return failure(e);
	}
}

/** Forgets this browser. */
export async function DELETE(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	const body = await req.json().catch(() => ({}));
	try {
		return NextResponse.json(
			await apiRequest<{ removed: number }>("/api/push/subscriptions", {
				method: "DELETE",
				body,
				sessionToken,
			}),
		);
	} catch (e) {
		return failure(e);
	}
}
