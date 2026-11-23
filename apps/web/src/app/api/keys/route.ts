import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { crossSiteRefusal } from "@/lib/same-origin";
import type { ApiKey } from "@/lib/types";
import { NextResponse } from "next/server";

export const preferredRegion = "fra1";

function unauthorized() {
	return NextResponse.json({ error: "Sign in first" }, { status: 401 });
}

function fromError(e: unknown) {
	if (e instanceof ApiError) {
		return NextResponse.json(
			{ error: e.message, retryAfter: e.retryAfter },
			{ status: e.status },
		);
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
	const refused = crossSiteRefusal(req);
	if (refused) return refused;
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
		return NextResponse.json(
			{ key: minted.key },
			{ status: 201, headers: { "Cache-Control": "no-store" } },
		);
	} catch (e) {
		return fromError(e);
	}
}
