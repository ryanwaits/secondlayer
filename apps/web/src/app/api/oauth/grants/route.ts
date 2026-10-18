import { proxyOauth } from "@/lib/oauth-proxy";

/** The account's connected apps, for the keys page. */
export async function GET(req: Request) {
	return proxyOauth(req, "/api/oauth/grants", "GET");
}
