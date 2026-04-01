import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const url = new URL(req.url);
		const allowed = new URLSearchParams();
		const category = url.searchParams.get("category");
		const resourceId = url.searchParams.get("resource_id");
		if (category) allowed.set("category", category);
		if (resourceId) allowed.set("resource_id", resourceId);
		const qs = allowed.toString();
		const data = await apiRequest(`/api/insights${qs ? `?${qs}` : ""}`, {
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
