import { proxyApiRequest } from "@/lib/api";

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params;
	return proxyApiRequest(
		req,
		`/api/subgraphs/${encodeURIComponent(name)}/stop`,
		{
			method: "POST",
			revalidate: ["subgraphs", `subgraph-${name}`],
		},
	);
}
