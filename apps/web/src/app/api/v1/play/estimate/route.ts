import { ApiError, apiRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
	const token = req.headers.get("X-Claim-Token") ?? "";
	try {
		const data = await apiRequest("/v1/play/estimate", {
			method: "GET",
			headers: { "X-Claim-Token": token },
		});
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
