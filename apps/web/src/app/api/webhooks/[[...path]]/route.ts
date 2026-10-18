import { PLATFORM_API_URL, getSessionFromRequest } from "@/lib/api";
import { upstreamAgent } from "@/lib/upstream-agent";
import { NextResponse } from "next/server";
import type { Agent } from "undici";

/**
 * Proxy to the hosted webhooks API for the signed-in account's dashboard. The
 * dashboard reads, pauses, resumes, renames (a name-only PATCH), sends a
 * test event, replays a block range and requeues dead events. Create, edit,
 * rotate and delete happen in the CLI/SDK and never go through here; an
 * allowlist enforces that at the route level, not just in the UI.
 *
 * Forwards with `fetch` directly (not `apiRequest`, which drops response
 * headers) so a `503`'s `Retry-After` reaches the client — the list/detail
 * pages need it to poll a starting hosted stack without hammering it.
 */

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

type Method = "GET" | "POST" | "PATCH";

/** Query params the dashboard reads with; everything else is dropped. */
const FORWARDED_QUERY = ["from", "to", "days", "_limit", "_offset", "wake"];

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
		if (segments.length === 2 && segments[1] === "replays") return true;
		// one delivery, read when a dashboard row is opened; one replay's progress
		return (
			segments.length === 3 &&
			(segments[1] === "deliveries" || segments[1] === "replays")
		);
	}
	if (method === "POST") {
		if (segments.length === 3) {
			return segments[1] === "dead" && segments[2] === "requeue";
		}
		return (
			segments.length === 2 &&
			(segments[1] === "pause" ||
				segments[1] === "resume" ||
				segments[1] === "test" ||
				segments[1] === "replay")
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

const REPLAY_ID_RE = /^[0-9a-f]{16}$/;

/** True when `body` is a plain object whose keys are all in `allowed`. */
function onlyKeys(body: unknown, allowed: readonly string[]): boolean {
	return (
		typeof body === "object" &&
		body !== null &&
		!Array.isArray(body) &&
		Object.keys(body).every((key) => allowed.includes(key))
	);
}

/** The cleaned replay request when `body` is `{ fromBlock, toBlock, force? }`; else null. */
function replayBody(
	body: unknown,
): { fromBlock: number; toBlock: number; force?: string } | null {
	if (!onlyKeys(body, ["fromBlock", "toBlock", "force"])) return null;
	const { fromBlock, toBlock, force } = body as Record<string, unknown>;
	if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock)) return null;
	const from = fromBlock as number;
	const to = toBlock as number;
	if (from < 0 || to < 0 || from > to) return null;
	if (force === undefined) return { fromBlock: from, toBlock: to };
	if (typeof force !== "string" || force.length < 1 || force.length > 64) {
		return null;
	}
	return { fromBlock: from, toBlock: to, force };
}

/** The cleaned bulk-requeue request when `body` is `{}` or has `replayId` / `since`; else null. */
function requeueBody(
	body: unknown,
): { replayId?: string; since?: string } | null {
	if (!onlyKeys(body, ["replayId", "since"])) return null;
	const { replayId, since } = body as Record<string, unknown>;
	const out: { replayId?: string; since?: string } = {};
	if (replayId !== undefined) {
		if (typeof replayId !== "string" || !REPLAY_ID_RE.test(replayId)) {
			return null;
		}
		out.replayId = replayId;
	}
	if (since !== undefined) {
		if (typeof since !== "string" || Number.isNaN(Date.parse(since))) {
			return null;
		}
		out.since = since;
	}
	return out;
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
	const bodyParser =
		method === "PATCH"
			? (parsed: unknown) => {
					const name = nameOnlyBody(parsed);
					return name === null ? null : { name };
				}
			: method === "POST" && segments[1] === "replay"
				? replayBody
				: method === "POST" && segments[1] === "dead"
					? requeueBody
					: null;
	if (bodyParser) {
		let parsed: unknown;
		try {
			parsed = await req.json();
		} catch {
			return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
		}
		const clean = bodyParser(parsed);
		if (clean === null) return notAvailable();
		body = JSON.stringify(clean);
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

	const started = performance.now();
	try {
		const upstream = await fetch(
			`${PLATFORM_API_URL}${upstreamPath}${search}`,
			{
				method,
				headers,
				body,
				cache: "no-store",
				// Why: reuse warm connections to the API; undici's default drops idle ones after 4 s.
				dispatcher: upstreamAgent,
			} as RequestInit & { dispatcher: Agent },
		);

		let payload: unknown = null;
		try {
			payload = await upstream.json();
		} catch {
			payload = null;
		}

		const responseHeaders: Record<string, string> = {
			"Server-Timing": `upstream;dur=${(performance.now() - started).toFixed(1)}`,
		};
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
