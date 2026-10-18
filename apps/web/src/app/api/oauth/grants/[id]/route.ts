import { proxyOauth } from "@/lib/oauth-proxy";

/** Revoke a connected app: its tokens stop working at once. */
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
