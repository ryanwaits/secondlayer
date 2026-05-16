import { proxyApiRequest } from "@/lib/api";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ name: string; table: string }> },
) {
	const { name, table } = await params;
	return proxyApiRequest(req, `/api/subgraphs/${name}/${table}/count`);
}
