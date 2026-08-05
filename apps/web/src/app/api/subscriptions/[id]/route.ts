import { proxyApiRequest } from "@/lib/api";

interface RouteParams {
	params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
	const { id } = await params;
	return proxyApiRequest(req, `/api/subscriptions/${encodeURIComponent(id)}`);
}

export async function PATCH(req: Request, { params }: RouteParams) {
	const { id } = await params;
	const body = await req.json().catch(() => null);
	if (!body) {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}
	return proxyApiRequest(req, `/api/subscriptions/${encodeURIComponent(id)}`, {
		method: "PATCH",
		body,
		revalidate: "subscriptions",
	});
}

export async function DELETE(req: Request, { params }: RouteParams) {
	const { id } = await params;
	return proxyApiRequest(req, `/api/subscriptions/${encodeURIComponent(id)}`, {
		method: "DELETE",
		revalidate: "subscriptions",
	});
}
