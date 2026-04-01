import { ApiError, apiRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
	try {
		const { email } = await req.json();
		const data = await apiRequest("/api/waitlist", {
			method: "POST",
			body: { email, source: "website" },
		});
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
