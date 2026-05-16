import { proxyApiRequest } from "@/lib/api";

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	return proxyApiRequest(req, `/api/subscriptions/${id}/pause`, {
		method: "POST",
		revalidate: "subscriptions",
	});
}
