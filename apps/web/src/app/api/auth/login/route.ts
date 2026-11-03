import { ApiError, apiRequest } from "@/lib/api";
import { NextResponse } from "next/server";

// Next to the API, so each dashboard read and write takes the short hop.
export const preferredRegion = "fra1";

export async function POST(req: Request) {
	try {
		const { email } = await req.json();
		const data = await apiRequest("/api/auth/magic-link", {
			method: "POST",
			body: { email },
		});
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
