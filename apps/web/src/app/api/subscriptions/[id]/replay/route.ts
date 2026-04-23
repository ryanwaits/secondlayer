import { getSessionFromRequest } from "@/lib/api";
import { fetchFromTenant } from "@/lib/tenant-api";
import { NextResponse } from "next/server";

interface RouteParams {
	params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const { id } = await params;
	const body = await req.json().catch(() => null);
	if (!body) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}
	const { ok, status, data } = await fetchFromTenant(
		sessionToken,
		`/api/subscriptions/${id}/replay`,
		{ method: "POST", body },
	);
	return NextResponse.json(data, { status: ok ? 202 : status });
}
