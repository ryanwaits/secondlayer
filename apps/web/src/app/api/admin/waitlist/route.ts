import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const url = new URL(req.url);
		const status = url.searchParams.get("status") || "";
		const qs = status ? `?status=${status}` : "";
		const data = await apiRequest(`/api/admin/waitlist${qs}`, { sessionToken });
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
