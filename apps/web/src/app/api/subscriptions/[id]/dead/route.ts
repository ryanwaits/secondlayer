import { proxyApiRequest } from "@/lib/api";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	return proxyApiRequest(req, `/api/subscriptions/${id}/dead`);
}
