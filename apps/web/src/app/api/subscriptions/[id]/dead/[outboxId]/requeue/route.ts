import { getSessionFromRequest } from "@/lib/api";
import { fetchFromTenant } from "@/lib/tenant-api";
import { NextResponse } from "next/server";

interface RouteParams {
	params: Promise<{ id: string; outboxId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const { id, outboxId } = await params;
	const { ok, status, data } = await fetchFromTenant(
		sessionToken,
		`/api/subscriptions/${id}/dead/${outboxId}/requeue`,
		{ method: "POST" },
	);
	return NextResponse.json(data, { status: ok ? 200 : status });
}
