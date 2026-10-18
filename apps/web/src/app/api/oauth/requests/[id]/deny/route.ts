import { proxyOauth } from "@/lib/oauth-proxy";

/** Deny an app: the API answers with the app's redirect, carrying access_denied. */
export async function POST(
	req: Request,
	context: { params: Promise<{ id: string }> },
) {
	const { id } = await context.params;
	return proxyOauth(
		req,
		`/api/oauth/requests/${encodeURIComponent(id)}/deny`,
		"POST",
	);
}
