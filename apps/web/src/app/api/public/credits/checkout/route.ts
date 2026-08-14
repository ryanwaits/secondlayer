import { ApiError, apiRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
	const body = await req.json().catch(() => null);
	if (!body || typeof body !== "object") {
		return NextResponse.json({ error: "Invalid body" }, { status: 400 });
	}

	try {
		const data = await apiRequest<{ url: string }>(
			"/api/public/credits/checkout",
			{ method: "POST", body },
		);
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
