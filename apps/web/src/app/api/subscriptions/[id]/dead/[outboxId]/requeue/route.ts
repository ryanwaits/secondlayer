import { proxyApiRequest } from "@/lib/api";

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ id: string; outboxId: string }> },
) {
	const { id, outboxId } = await params;
	return proxyApiRequest(
		req,
		`/api/subscriptions/${encodeURIComponent(id)}/dead/${encodeURIComponent(outboxId)}/requeue`,
		{ method: "POST" },
	);
}
