import { proxyApiRequest } from "@/lib/api";

export async function GET(req: Request) {
	return proxyApiRequest(req, "/api/subgraphs");
}

export async function POST(req: Request) {
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	return proxyApiRequest(req, "/api/subgraphs", {
		method: "POST",
		body,
		headers: { "x-sl-origin": "session" },
	});
}
