import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

/** Revoke one of the signed-in account's keys. The API checks ownership. */
export async function DELETE(
	req: Request,
	context: { params: Promise<{ id: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	const { id } = await context.params;
	try {
		await apiRequest(`/api/keys/${encodeURIComponent(id)}`, {
			method: "DELETE",
			sessionToken,
		});
		return NextResponse.json({ revoked: id });
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
