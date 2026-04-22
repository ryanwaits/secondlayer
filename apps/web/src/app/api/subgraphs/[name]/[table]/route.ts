import { getSessionFromRequest } from "@/lib/api";
import { fetchFromTenant } from "@/lib/tenant-api";
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

	const { ok, status, data } = await fetchFromTenant(
		sessionToken,
		`/api/subgraphs/${name}/${table}`,
		{ query: allowed },
	);
	return NextResponse.json(data, { status: ok ? 200 : status });
}
