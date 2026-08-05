import { requireAdmin } from "@/lib/admin";
import { ApiError, apiRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
	const admin = await requireAdmin(req);
	if (!admin.ok) return admin.response;

	try {
		const data = await apiRequest("/api/admin/stats", {
			sessionToken: admin.sessionToken,
		});
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
