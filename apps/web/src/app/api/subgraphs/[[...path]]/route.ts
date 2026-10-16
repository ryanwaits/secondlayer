import { PLATFORM_API_URL, getSessionFromRequest } from "@/lib/api";
import { upstreamAgent } from "@/lib/upstream-agent";
import { NextResponse } from "next/server";
import type { Agent } from "undici";

/**
 * Read-only proxy to the signed-in account's hosted subgraphs. The dashboard
 * lists, inspects and reads rows; deploy, reindex, stop and delete stay in the
 * CLI. Only `GET` is exported, and an allowlist of path shapes enforces the
 * rest at the route level.
 *
 * Forwards with `fetch` directly (not `apiRequest`) so a starting stack's
 * `Retry-After` reaches the client, and streams the row tail through as SSE.
 */

export const dynamic = "force-dynamic";

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
/** The one literal that carries a dot. */
const SCHEMA_JSON = "schema.json";
const READ_SUFFIXES = new Set(["health", "errors", "gaps", SCHEMA_JSON]);

/** Query keys the proxy forwards: `_sort`, `_order`, `cursor` and table
 *  columns with an optional `.gte`-style suffix. Values are validated upstream. */
const QUERY_KEY_RE = /^[A-Za-z0-9_.]+$/;

type Target = { path: string; stream: boolean };

/** The upstream path for an allowed shape, or null (405). `segments` excludes
 *  the leading `/api/subgraphs`. */
function targetFor(segments: string[]): Target | null {
	const [name, kind, table, tail] = segments;
	if (segments.length === 0) return { path: "/api/subgraphs", stream: false };
	if (segments.length === 1) {
		return { path: `/api/subgraphs/${name}`, stream: false };
	}
	if (segments.length === 2 && kind && READ_SUFFIXES.has(kind)) {
		return { path: `/api/subgraphs/${name}/${kind}`, stream: false };
	}
	if (kind === "rows" && table) {
		if (segments.length === 3) {
			return { path: `/v1/subgraphs/${name}/${table}`, stream: false };
		}
		if (segments.length === 4 && tail === "count") {
			return { path: `/v1/subgraphs/${name}/${table}/count`, stream: false };
		}
		if (segments.length === 4 && tail === "stream") {
			return { path: `/v1/subgraphs/${name}/${table}/stream`, stream: true };
		}
	}
	return null;
}

function forwardedSearch(req: Request): string {
	const query = new URLSearchParams();
	for (const [key, value] of new URL(req.url).searchParams) {
		if (QUERY_KEY_RE.test(key)) query.append(key, value);
	}
	return query.size > 0 ? `?${query}` : "";
}

export async function GET(
	req: Request,
	context: { params: Promise<{ path?: string[] }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}

	const { path } = await context.params;
	const segments = path ?? [];
	for (const segment of segments) {
		if (segment !== SCHEMA_JSON && !SEGMENT_RE.test(segment)) {
			return NextResponse.json(
				{ error: "Invalid request path" },
				{ status: 400 },
			);
		}
	}
	const target = targetFor(segments);
	if (!target) {
		return NextResponse.json(
			{ error: "Not available from the dashboard" },
			{ status: 405 },
		);
	}

	const started = performance.now();
	try {
		const upstream = await fetch(
			`${PLATFORM_API_URL}${target.path}${forwardedSearch(req)}`,
			{
				method: "GET",
				headers: { Authorization: `Bearer ${sessionToken}` },
				cache: "no-store",
				...(target.stream ? { signal: req.signal } : {}),
				// Why: reuse warm connections to the API; undici's default drops idle ones after 4 s.
				dispatcher: upstreamAgent,
			} as RequestInit & { dispatcher: Agent },
		);

		if (target.stream && upstream.ok && upstream.body) {
			return new Response(upstream.body, {
				status: upstream.status,
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
				},
			});
		}

		let payload: unknown = null;
		try {
			payload = await upstream.json();
		} catch {
			payload = null;
		}
		const headers: Record<string, string> = {
			"Server-Timing": `upstream;dur=${(performance.now() - started).toFixed(1)}`,
		};
		const retryAfter = upstream.headers.get("Retry-After");
		if (retryAfter) headers["Retry-After"] = retryAfter;
		return NextResponse.json(payload, { status: upstream.status, headers });
	} catch {
		return NextResponse.json(
			{ error: "upstream_unavailable" },
			{ status: 502 },
		);
	}
}
