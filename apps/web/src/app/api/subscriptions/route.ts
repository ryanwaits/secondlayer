import { proxyApiRequest } from "@/lib/api";

export async function GET(req: Request) {
	return proxyApiRequest(req, "/api/subscriptions");
}

export async function POST(req: Request) {
	const body = await req.json().catch(() => null);
	if (!body) {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}
	return proxyApiRequest(req, "/api/subscriptions", {
		method: "POST",
		body,
		revalidate: "subscriptions",
	});
}
