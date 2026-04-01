import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ name: string; table: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { name, table } = await params;
	const { searchParams } = new URL(req.url);
	const ALLOWED_PARAMS = ["_limit", "_offset", "_sort", "_order"];
	const allowed = new URLSearchParams();
	for (const key of ALLOWED_PARAMS) {
		const val = searchParams.get(key);
		if (val) allowed.set(key, val);
	}
	const qs = allowed.toString();

	try {
		const data = await apiRequest(
			`/api/subgraphs/${name}/${table}${qs ? `?${qs}` : ""}`,
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
