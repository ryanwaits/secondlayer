import { getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

const API_URL = process.env.SL_API_URL || "http://localhost:3800";

/**
 * Thin passthrough to the Hetzner API's server-side subgraph bundler.
 * Mirrors apps/web/src/app/api/sessions/bundle-workflow/route.ts — Vercel
 * can't reliably run esbuild + data-URI imports, so the chat authoring loop
 * delegates bundling to the Hetzner API which has a warm workspace.
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
		const upstream = await fetch(`${API_URL}/api/subgraphs/bundle`, {
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
