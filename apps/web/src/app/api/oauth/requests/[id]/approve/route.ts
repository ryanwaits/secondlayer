import { proxyOauth } from "@/lib/oauth-proxy";

/** Allow an app: the API answers with the app's redirect, carrying a one-time code. */
export async function POST(
	req: Request,
	context: { params: Promise<{ id: string }> },
) {
	const { id } = await context.params;
	return proxyOauth(
		req,
		`/api/oauth/requests/${encodeURIComponent(id)}/approve`,
		"POST",
	);
}
