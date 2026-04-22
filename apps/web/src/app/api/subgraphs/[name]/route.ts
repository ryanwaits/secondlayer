import { getSessionFromRequest } from "@/lib/api";
import { fetchFromTenant } from "@/lib/tenant-api";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { name } = await params;
	const { ok, status, data } = await fetchFromTenant(
		sessionToken,
		`/api/subgraphs/${name}`,
	);
	return NextResponse.json(data, { status: ok ? 200 : status });
}

export async function DELETE(
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
		`/api/subgraphs/${name}`,
		{ method: "DELETE" },
	);
	if (ok) revalidateTag("subgraphs", { expire: 0 });
	return NextResponse.json(data, { status: ok ? 200 : status });
}
