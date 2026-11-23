import { ApiError, apiRequest } from "@/lib/api";
import { crossSiteRefusal } from "@/lib/same-origin";
import { NextResponse } from "next/server";

export const preferredRegion = "fra1";

export async function POST(req: Request) {
	const refused = crossSiteRefusal(req);
	if (refused) return refused;
	try {
		const { email, from, distinctId } = await req.json();
		const data = await apiRequest("/api/auth/magic-link", {
			method: "POST",
			body: { email, from, distinctId },
		});
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
