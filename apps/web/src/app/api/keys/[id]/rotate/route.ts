import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { isSameOrigin } from "@/lib/same-origin";
import { NextResponse } from "next/server";

// Next to the API, so each dashboard read and write takes the short hop.
export const preferredRegion = "fra1";

/**
 * Replace one of the signed-in account's keys with a new secret under the same
 * name. The session cookie is the only credential (an Authorization header is
 * refused), the request must come from this site's own pages, and the response
 * is never cached. The new key is in the response body once; this route does
 * not log it and the API stores only its hash. The API checks ownership.
 */

const NO_STORE = { "Cache-Control": "no-store" };

const reply = (body: unknown, status: number) =>
	NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(
	req: Request,
	context: { params: Promise<{ id: string }> },
) {
	if (req.headers.has("authorization"))
		return reply({ error: "Use the session cookie" }, 400);
	if (!isSameOrigin(req)) return reply({ error: "Forbidden" }, 403);
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) return reply({ error: "Sign in first" }, 401);
	const { id } = await context.params;
	try {
		const rotated = await apiRequest<{ key: string; name: string | null }>(
			`/api/keys/${encodeURIComponent(id)}/rotate`,
			{ method: "POST", body: {}, sessionToken },
		);
		return reply({ key: rotated.key, name: rotated.name }, 201);
	} catch (e) {
		if (e instanceof ApiError)
			return reply({ error: e.message, retryAfter: e.retryAfter }, e.status);
		return reply({ error: "Internal error" }, 500);
	}
}
