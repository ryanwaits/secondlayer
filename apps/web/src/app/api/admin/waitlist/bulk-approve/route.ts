import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const body = await req.json();
		const data = await apiRequest("/api/admin/waitlist/bulk-approve", {
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
