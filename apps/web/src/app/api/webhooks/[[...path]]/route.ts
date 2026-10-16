import { PLATFORM_API_URL, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

/**
 * Proxy to the hosted webhooks API for the signed-in account's dashboard. The
 * dashboard reads, pauses and resumes, and renames (a name-only PATCH).
 * Create, edit, replay, requeue, test, rotate and delete happen in the
 * CLI/SDK and never go through here; an allowlist enforces that at the route
 * level, not just in the UI.
 *
 * Forwards with `fetch` directly (not `apiRequest`, which drops response
 * headers) so a `503`'s `Retry-After` reaches the client — the list/detail
 * pages need it to poll a starting hosted stack without hammering it.
 */

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

type Method = "GET" | "POST" | "PATCH";

/** Query params the dashboard reads with; everything else is dropped. */
const FORWARDED_QUERY = ["from", "to", "days", "_limit", "_offset"];

const MAX_NAME_LENGTH = 128;

/** Matches an allowed (method, path-shape) pair. `segments` excludes the
 *  leading `/api/webhooks`. Anything not matched here is refused with 405,
 *  before it is forwarded to the platform API. */
function isAllowed(method: Method, segments: string[]): boolean {
	if (method === "GET") {
		if (segments.length === 0) return true; // list
		if (segments.length === 1) return true; // get one
		if (
			segments.length === 2 &&
			(segments[1] === "deliveries" ||
				segments[1] === "dead" ||
				segments[1] === "activity")
		) {
			return true;
		}
		return false;
	}
	if (method === "POST") {
		return (
			segments.length === 2 &&
			(segments[1] === "pause" || segments[1] === "resume")
		);
	}
	// PATCH: rename one webhook
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

/** The trimmed name when the body is exactly `{ name }` with a 1-128 character string; else null. */
function nameOnlyBody(body: unknown): string | null {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return null;
	}
	const keys = Object.keys(body);
	if (keys.length !== 1 || keys[0] !== "name") return null;
	const name = (body as { name: unknown }).name;
	if (typeof name !== "string") return null;
	const trimmed = name.trim();
	return trimmed.length >= 1 && trimmed.length <= MAX_NAME_LENGTH
		? trimmed
		: null;
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

	const headers: Record<string, string> = {
		Authorization: `Bearer ${sessionToken}`,
	};
	let body: string | undefined;
	if (method === "PATCH") {
		let parsed: unknown;
		try {
			parsed = await req.json();
		} catch {
			return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
		}
		const name = nameOnlyBody(parsed);
		if (name === null) return notAvailable();
		body = JSON.stringify({ name });
		headers["Content-Type"] = "application/json";
	}

	const incoming = new URL(req.url).searchParams;
	const query = new URLSearchParams();
	for (const key of FORWARDED_QUERY) {
		const value = incoming.get(key);
		if (value !== null) query.set(key, value);
	}
	const search = query.size > 0 ? `?${query}` : "";
	const upstreamPath =
		segments.length > 0
			? `/api/webhooks/${segments.join("/")}`
			: "/api/webhooks";

	try {
		const upstream = await fetch(
			`${PLATFORM_API_URL}${upstreamPath}${search}`,
			{
				method,
				headers,
				body,
				cache: "no-store",
			},
		);

		let payload: unknown = null;
		try {
			payload = await upstream.json();
		} catch {
			payload = null;
		}

		const responseHeaders: Record<string, string> = {};
		const retryAfter = upstream.headers.get("Retry-After");
		if (retryAfter) responseHeaders["Retry-After"] = retryAfter;

		return NextResponse.json(payload, {
			status: upstream.status,
			headers: responseHeaders,
		});
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

export async function PATCH(
	req: Request,
	context: { params: Promise<{ path?: string[] }> },
) {
	const { path } = await context.params;
	return handle(req, "PATCH", path);
}
