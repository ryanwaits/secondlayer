import { proxyApiRequest } from "@/lib/api";

// Recent reindex/backfill operations, newest first. Polled by the detail
// page's status pill: the active op is the first queued/running entry, and
// the newest terminal entry is what the pill settles on when a job finishes.
export async function GET(
	req: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params;
	return proxyApiRequest(
		req,
		`/api/subgraphs/${encodeURIComponent(name)}/operations`,
	);
}
