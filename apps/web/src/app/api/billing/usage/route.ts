import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { type UsageRow, currentUtcMonth, monthParam } from "@/lib/usage";
import { NextResponse } from "next/server";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** This account's usage_ledger for one UTC calendar month, by unit. Defaults
 *  to the current UTC month when `month` is absent; matches the upstream
 *  platform route's own validation (`packages/api/src/routes/billing.ts`). */
export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}
	const url = new URL(req.url);
	const month = url.searchParams.get("month") ?? monthParam(currentUtcMonth());
	if (!MONTH_RE.test(month)) {
		return NextResponse.json(
			{ error: "month must be YYYY-MM" },
			{ status: 400 },
		);
	}
	try {
		const data = await apiRequest<{ month: string; usage: UsageRow[] }>(
			`/api/billing/usage?month=${month}`,
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
