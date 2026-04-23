import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const { id } = await params;
	try {
		const data = await apiRequest<{
			ok: boolean;
			runId?: string;
			error?: string;
		}>(`/api/sentries/${id}/test`, {
			method: "POST",
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
