import { getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

const API_URL = process.env.SL_API_URL || "http://localhost:3800";

/**
 * Thin passthrough to the Hetzner API's server-side workflow bundler.
 *
 * Why this isn't bundling locally: Vercel's serverless Node runtime has no
 * stable node_modules layout for esbuild's resolver, and `import(dataUri)`
 * can't resolve bare specifiers. Every attempt to run `@secondlayer/bundler`
 * in this function hit a different edge case. The Hetzner API service has a
 * warm workspace, a stable esbuild binary, and already validates bundled
 * handlers downstream in POST /api/workflows — moving bundling there
 * eliminates the whole class of Vercel-specific failures.
 *
 * This route preserves the same auth + response shape so the chat deploy
 * card (`apps/web/src/components/sessions/tool-part-renderer.tsx`) doesn't
 * need to change.
 */
export async function POST(req: Request) {
	const session = getSessionFromRequest(req);
	if (!session) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: { code?: unknown };
	try {
		body = (await req.json()) as { code?: unknown };
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	if (typeof body.code !== "string" || body.code.length === 0) {
		return NextResponse.json(
			{ error: "Missing `code` string in body" },
			{ status: 400 },
		);
	}

	try {
		const upstream = await fetch(`${API_URL}/api/workflows/bundle`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${session}`,
				"x-sl-origin": "session",
			},
			body: JSON.stringify({ code: body.code }),
		});
		const text = await upstream.text();
		try {
			const json = JSON.parse(text);
			return NextResponse.json(json, { status: upstream.status });
		} catch {
			return NextResponse.json(
				{
					ok: false,
					error: text || `Upstream HTTP ${upstream.status}`,
					code: "UPSTREAM_INVALID_RESPONSE",
				},
				{ status: upstream.status || 502 },
			);
		}
	} catch (err) {
		return NextResponse.json(
			{
				ok: false,
				error: err instanceof Error ? err.message : String(err),
				code: "UPSTREAM_UNREACHABLE",
			},
			{ status: 502 },
		);
	}
}
