import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const { id } = await params;
		const url = new URL(req.url);
		const limit = Math.min(
			Math.max(Number.parseInt(url.searchParams.get("limit") || "50") || 50, 1),
			1000,
		);
		const offset = Math.max(
			Number.parseInt(url.searchParams.get("offset") || "0") || 0,
			0,
		);
		const VALID_STATUSES = ["success", "failed", "pending"];
		const rawStatus = url.searchParams.get("status") || "";
		const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : "";
		const qs = `limit=${limit}&offset=${offset}${status ? `&status=${status}` : ""}`;
		const data = await apiRequest(`/api/streams/${id}/deliveries?${qs}`, {
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
