import { PLATFORM_API_URL, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

/**
 * Proxy to the hosted webhooks API for the signed-in account's dashboard —
 * watch and fix only. Create, update and replay never go through here (the
 * founder rule: the web never creates or edits a webhook); an allowlist
 * enforces that at the route level, not just in the UI.
 *
 * Forwards with `fetch` directly (not `apiRequest`, which drops response
 * headers) so a `503`'s `Retry-After` reaches the client — the list/detail
 * pages need it to poll a starting delivery service without hammering it.
 */

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

type Method = "GET" | "POST" | "DELETE";

/** Matches an allowed (method, path-shape) pair. `segments` excludes the
 *  leading `/api/webhooks`. Anything not matched here is refused with 405,
 *  before it is forwarded to the platform API. */
function isAllowed(method: Method, segments: string[]): boolean {
	if (method === "GET") {
		if (segments.length === 0) return true; // list
		if (segments.length === 1) return true; // get one
		if (
			segments.length === 2 &&
			(segments[1] === "deliveries" || segments[1] === "dead")
		) {
			return true;
		}
		return false;
	}
	if (method === "POST") {
		if (
			segments.length === 2 &&
			(segments[1] === "test" ||
				segments[1] === "pause" ||
				segments[1] === "resume" ||
				segments[1] === "rotate-secret")
		) {
			return true;
		}
		if (
			segments.length === 4 &&
			segments[1] === "dead" &&
			segments[3] === "requeue"
		) {
			return true;
		}
		return false;
	}
	// DELETE
	return segments.length === 1;
}

function unauthorized() {
	return NextResponse.json({ error: "Sign in first" }, { status: 401 });
}

function notAvailable() {
	return NextResponse.json(
		{ error: "Not available from the dashboard" },
		{ status: 405 },
	);
}

function badSegment() {
	return NextResponse.json({ error: "Invalid request path" }, { status: 400 });
}

async function handle(
	req: Request,
	method: Method,
	rawSegments: string[] | undefined,
): Promise<NextResponse> {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) return unauthorized();

	const segments = rawSegments ?? [];
	for (const segment of segments) {
		if (!SEGMENT_RE.test(segment)) return badSegment();
	}
	if (!isAllowed(method, segments)) return notAvailable();

	const upstreamPath =
		segments.length > 0
			? `/api/webhooks/${segments.join("/")}`
			: "/api/webhooks";

	try {
		const upstream = await fetch(`${PLATFORM_API_URL}${upstreamPath}`, {
			method,
			headers: { Authorization: `Bearer ${sessionToken}` },
			cache: "no-store",
		});

		let body: unknown = null;
		try {
			body = await upstream.json();
		} catch {
			body = null;
		}

		const headers: Record<string, string> = {};
		const retryAfter = upstream.headers.get("Retry-After");
		if (retryAfter) headers["Retry-After"] = retryAfter;

		return NextResponse.json(body, { status: upstream.status, headers });
	} catch {
		return NextResponse.json(
			{ error: "upstream_unavailable" },
			{ status: 502 },
		);
	}
}

export async function GET(
	req: Request,
	context: { params: Promise<{ path?: string[] }> },
) {
	const { path } = await context.params;
	return handle(req, "GET", path);
}

export async function POST(
	req: Request,
	context: { params: Promise<{ path?: string[] }> },
) {
	const { path } = await context.params;
	return handle(req, "POST", path);
}

export async function DELETE(
	req: Request,
	context: { params: Promise<{ path?: string[] }> },
) {
	const { path } = await context.params;
	return handle(req, "DELETE", path);
}
