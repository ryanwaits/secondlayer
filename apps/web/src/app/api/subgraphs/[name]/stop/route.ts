import { getSessionFromRequest } from "@/lib/api";
import { fetchFromTenant } from "@/lib/tenant-api";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { name } = await params;
	const { ok, status, data } = await fetchFromTenant<{ message: string }>(
		sessionToken,
		`/api/subgraphs/${name}/stop`,
		{ method: "POST" },
	);
	if (ok) {
		revalidateTag("subgraphs", { expire: 0 });
		revalidateTag(`subgraph-${name}`, { expire: 0 });
	}
	return NextResponse.json(data, { status: ok ? 200 : status });
}
