import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

/**
 * POST — upload or rotate the SSH pubkey that authorizes this account's
 * bastion user (`tenant-<slug>`). Body: `{ publicKey: string }`.
 */
export async function POST(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	try {
		const body = await req.json().catch(() => ({}));
		const data = await apiRequest("/api/tenants/me/db-access/key", {
			method: "POST",
			body,
			sessionToken,
		});
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}

/** DELETE — revoke the bastion user for this tenant. */
export async function DELETE(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	try {
		const data = await apiRequest("/api/tenants/me/db-access/key", {
			method: "DELETE",
			sessionToken,
		});
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
