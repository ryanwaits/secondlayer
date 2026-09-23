import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

/** The signed-in account's prepaid balance and this month's spend. */
export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	try {
		const status = await apiRequest<{
			creditsUsdMicros: string;
			creditsSpentThisMonthUsdMicros: string;
		}>("/api/billing/status", { sessionToken });
		return NextResponse.json({
			creditsUsdMicros: status.creditsUsdMicros,
			spentThisMonthUsdMicros: status.creditsSpentThisMonthUsdMicros,
		});
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
