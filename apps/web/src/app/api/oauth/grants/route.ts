import { proxyOauth } from "@/lib/oauth-proxy";

export async function GET(req: Request) {
	return proxyOauth(req, "/api/oauth/grants", "GET");
}
