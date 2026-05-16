import { proxyApiRequest } from "@/lib/api";

/**
 * Thin passthrough to the platform API's server-side subgraph bundler.
 * Vercel can't reliably run esbuild + data-URI imports, so the chat
 * authoring loop delegates bundling to the API host which has a warm
 * workspace.
 */
export async function POST(req: Request) {
	let body: { code?: unknown };
	try {
		body = (await req.json()) as { code?: unknown };
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	if (typeof body.code !== "string" || body.code.length === 0) {
		return Response.json(
			{ error: "Missing `code` string in body" },
			{ status: 400 },
		);
	}
	return proxyApiRequest(req, "/api/subgraphs/bundle", {
		method: "POST",
		body: { code: body.code },
		headers: { "x-sl-origin": "session" },
	});
}
