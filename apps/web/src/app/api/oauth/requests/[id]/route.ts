import { proxyOauth } from "@/lib/oauth-proxy";

export async function GET(
	req: Request,
	context: { params: Promise<{ id: string }> },
) {
	const { id } = await context.params;
	return proxyOauth(
		req,
		`/api/oauth/requests/${encodeURIComponent(id)}`,
		"GET",
	);
}
