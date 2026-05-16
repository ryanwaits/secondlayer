import { proxyApiRequest } from "@/lib/api";

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	return proxyApiRequest(req, `/api/subscriptions/${id}/resume`, {
		method: "POST",
		revalidate: "subscriptions",
	});
}
