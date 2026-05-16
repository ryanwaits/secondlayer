import { proxyApiRequest } from "@/lib/api";

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params;
	const body = await req.json().catch(() => ({}));
	return proxyApiRequest(req, `/api/subgraphs/${name}/reindex`, {
		method: "POST",
		body,
		revalidate: ["subgraphs", `subgraph-${name}`],
	});
}
