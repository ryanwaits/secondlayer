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
	const { ok, status, data } = await fetchFromTenant<{ count: number }>(
		sessionToken,
		`/api/subgraphs/${name}/${table}/count`,
	);
	return NextResponse.json(data, { status: ok ? 200 : status });
}
