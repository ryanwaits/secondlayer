import { ApiError, apiRequest } from "@/lib/api";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Minimal same-origin proxy for the client components that poll the
 * instance (live pill, delivery log, DLQ, pause/resume, replay…). Only the
 * paths the console screens actually use are forwarded; everything else is a
 * 404 rather than an open relay. `apiRequest` re-checks each segment against
 * traversal before the request leaves the box.
 */

const FORWARDED_ROOTS = new Set(["subgraphs", "subscriptions"]);

function upstreamPath(segments: string[], search: string): string {
	const [root, ...rest] = segments;
	// `/api/status` maps onto the instance's root-mounted `/status`.
	if (root === "status" && rest.length === 0) return `/status${search}`;
	if (root && FORWARDED_ROOTS.has(root)) {
		const path = [root, ...rest].map(encodeURIComponent).join("/");
		return `/api/${path}${search}`;
	}
	throw new ApiError(404, "Unknown console API route");
}

async function forward(
	req: NextRequest,
	ctx: { params: Promise<{ proxy: string[] }> },
): Promise<NextResponse> {
	const { proxy } = await ctx.params;

	let body: unknown;
	if (req.method === "POST") {
		// Some POSTs (reindex, pause/resume) carry no body on purpose — keep the
		// upstream request equally body-less rather than inventing `{}`.
		const raw = await req.text();
		if (raw) {
			try {
				body = JSON.parse(raw);
			} catch {
				return NextResponse.json(
					{ error: "Request body must be JSON" },
					{ status: 400 },
				);
			}
		}
	}

	try {
		const data = await apiRequest<unknown>(
			upstreamPath(proxy, req.nextUrl.search),
			{ method: req.method, body },
		);
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json(
			{ error: "Instance unreachable" },
			{ status: 502 },
		);
	}
}

export const GET = forward;
export const POST = forward;
export const DELETE = forward;
