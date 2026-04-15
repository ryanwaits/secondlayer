import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ id: string; deliveryId: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const { id, deliveryId } = await params;
		const data = await apiRequest(
			`/api/streams/${id}/deliveries/${deliveryId}`,
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
