import { proxyOauth } from "@/lib/oauth-proxy";

export async function DELETE(
	req: Request,
	context: { params: Promise<{ id: string }> },
) {
	const { id } = await context.params;
	return proxyOauth(
		req,
		`/api/oauth/grants/${encodeURIComponent(id)}`,
		"DELETE",
	);
}
