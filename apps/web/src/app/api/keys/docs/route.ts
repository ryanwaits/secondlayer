import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { isSameOrigin } from "@/lib/same-origin";
import { NextResponse } from "next/server";

export const preferredRegion = "fra1";

const NO_STORE = { "Cache-Control": "no-store" };

const reply = (body: unknown, status: number, headers?: HeadersInit) =>
	NextResponse.json(body, {
		status,
		headers: { ...NO_STORE, ...headers },
	});

export async function POST(req: Request) {
	if (req.headers.has("authorization"))
		return reply({ error: "Use the session cookie" }, 400);
	if (!isSameOrigin(req)) return reply({ error: "Forbidden" }, 403);
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) return reply({ error: "Sign in first" }, 401);
	try {
		const minted = await apiRequest<{
			key: string;
			prefix: string;
			expiresAt: string;
		}>("/api/keys/docs", { method: "POST", body: {}, sessionToken });
		return reply(
			{ key: minted.key, prefix: minted.prefix, expiresAt: minted.expiresAt },
			201,
		);
	} catch (e) {
		if (e instanceof ApiError)
			return reply(
				{
					error:
						e.status === 429
							? "Limit reached for today"
							: "Couldn't mint a key",
				},
				e.status === 429 || e.status === 401 ? e.status : 502,
			);
		return reply({ error: "Internal error" }, 500);
	}
}
