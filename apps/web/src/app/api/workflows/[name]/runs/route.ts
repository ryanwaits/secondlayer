import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const { name } = await params;
		const url = new URL(req.url);
		const qs = new URLSearchParams();
		const status = url.searchParams.get("status");
		const limit = url.searchParams.get("limit");
		const offset = url.searchParams.get("offset");
		if (status) qs.set("status", status);
		if (limit) qs.set("limit", limit);
		if (offset) qs.set("offset", offset);
		const query = qs.toString();
		const data = await apiRequest(
			`/api/workflows/${name}/runs${query ? `?${query}` : ""}`,
			{ sessionToken },
		);
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
