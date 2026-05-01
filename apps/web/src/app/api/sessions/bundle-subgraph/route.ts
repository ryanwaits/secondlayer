import { getSessionFromRequest } from "@/lib/api";
import { fetchFromTenant } from "@/lib/tenant-api";
import { NextResponse } from "next/server";

/**
 * Thin passthrough to the tenant API's server-side subgraph bundler.
 * Vercel can't reliably run esbuild + data-URI imports, so the chat
 * authoring loop delegates bundling to the tenant API which has a warm
 * workspace.
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

	const result = await fetchFromTenant(session, "/api/subgraphs/bundle", {
		method: "POST",
		headers: { "x-sl-origin": "session" },
		body: { code: body.code },
	});
	return NextResponse.json(result.data, {
		status: result.ok ? 200 : result.status,
	});
}
