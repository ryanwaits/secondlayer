import { proxyApiRequest } from "@/lib/api";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params;
	return proxyApiRequest(req, `/api/subgraphs/${name}`);
}

export async function DELETE(
	req: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params;
	return proxyApiRequest(req, `/api/subgraphs/${name}`, {
		method: "DELETE",
		revalidate: "subgraphs",
	});
}
