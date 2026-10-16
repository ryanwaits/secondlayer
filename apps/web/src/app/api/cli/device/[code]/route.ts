import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

/** What the CLI sign-in approval page shows. Session only; the API checks it. */
export async function GET(
	req: Request,
	context: { params: Promise<{ code: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	const { code } = await context.params;
	try {
		const attempt = await apiRequest<{
			clientName: string;
			status: string;
			expiresAt: string;
		}>(`/api/cli/device/${encodeURIComponent(code)}`, { sessionToken });
		return NextResponse.json(attempt, {
			headers: { "Cache-Control": "no-store" },
		});
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
