import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	try {
		const body = await req.json().catch(() => ({}));
		const data = await apiRequest("/api/tenants/me/resize", {
			method: "POST",
			body,
			sessionToken,
		});
		revalidateTag("tenant", { expire: 0 });
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
