import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import type { ApiKey } from "@/lib/types";
import { NextResponse } from "next/server";

/**
 * The signed-in account's API keys, for /account. The session cookie is the
 * credential; the API does the owner check. A new key's full value is in the
 * POST response only, once. The API stores its hash.
 */

function unauthorized() {
	return NextResponse.json({ error: "Sign in first" }, { status: 401 });
}

function fromError(e: unknown) {
	if (e instanceof ApiError) {
		return NextResponse.json({ error: e.message }, { status: e.status });
	}
	return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) return unauthorized();
	try {
		const { keys } = await apiRequest<{ keys: ApiKey[] }>("/api/keys", {
			sessionToken,
		});
		return NextResponse.json({ keys: keys ?? [] });
	} catch (e) {
		return fromError(e);
	}
}

export async function POST(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) return unauthorized();
	const body = (await req.json().catch(() => ({}))) as { name?: unknown };
	const name =
		typeof body.name === "string" && body.name.trim()
			? body.name.trim().slice(0, 255)
			: undefined;
	try {
		const minted = await apiRequest<{ key: string }>("/api/keys", {
			method: "POST",
			body: name ? { name } : {},
			sessionToken,
		});
		return NextResponse.json({ key: minted.key }, { status: 201 });
	} catch (e) {
		return fromError(e);
	}
}
