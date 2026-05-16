import { proxyApiRequest } from "@/lib/api";

const ALLOWED_PARAMS = ["_limit", "_offset", "_sort", "_order"];

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ name: string; table: string }> },
) {
	const { name, table } = await params;
	const { searchParams } = new URL(req.url);
	const allowed = new URLSearchParams();
	for (const key of ALLOWED_PARAMS) {
		const val = searchParams.get(key);
		if (val) allowed.set(key, val);
	}
	return proxyApiRequest(req, `/api/subgraphs/${name}/${table}`, {
		query: allowed,
	});
}
