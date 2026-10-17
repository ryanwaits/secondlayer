import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { isSameOrigin } from "@/lib/same-origin";
import { NextResponse } from "next/server";

/** Approve a CLI sign-in: the API opens the machine's session when the CLI next polls. Session cookie only, from this site's own pages. */
export async function POST(
	req: Request,
	context: { params: Promise<{ code: string }> },
) {
	if (!isSameOrigin(req)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	const { code } = await context.params;

	try {
		await apiRequest(`/api/cli/device/${encodeURIComponent(code)}/approve`, {
			method: "POST",
			body: {},
			sessionToken,
		});
		return NextResponse.json({ status: "approved" });
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
