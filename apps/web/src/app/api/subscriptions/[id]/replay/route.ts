import { proxyApiRequest } from "@/lib/api";

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	const body = await req.json().catch(() => null);
	if (!body) {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}
	return proxyApiRequest(req, `/api/subscriptions/${id}/replay`, {
		method: "POST",
		body,
	});
}
