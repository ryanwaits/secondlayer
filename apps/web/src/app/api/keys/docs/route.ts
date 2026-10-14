import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { isSameOrigin } from "@/lib/same-origin";
import { NextResponse } from "next/server";

/**
 * The signed-in reader's docs key: a read-only (Streams + Index), 24 hour key
 * for the code samples. The session cookie is the only credential (an
 * Authorization header is refused), the request must come from this site's own
 * pages, and the response is never cached. The key is in the response body
 * once; this route does not log it and the API stores only its hash.
 */

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
