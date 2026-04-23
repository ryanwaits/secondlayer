import { getSessionFromRequest } from "@/lib/api";
import { fetchFromTenant } from "@/lib/tenant-api";
import { revalidateTag } from "next/cache";
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
	const { ok, status, data } = await fetchFromTenant(
		sessionToken,
		`/api/subscriptions/${id}/pause`,
		{ method: "POST" },
	);
	if (ok) revalidateTag("subscriptions", { expire: 0 });
	return NextResponse.json(data, { status });
}
