import { getSessionFromRequest } from "@/lib/api";
import { fetchFromTenant } from "@/lib/tenant-api";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { ok, status, data } = await fetchFromTenant<{ data: unknown[] }>(
		sessionToken,
		"/api/subscriptions",
	);
	return NextResponse.json(data, { status: ok ? 200 : status });
}

export async function POST(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await req.json().catch(() => null);
	if (!body) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { ok, status, data } = await fetchFromTenant(
		sessionToken,
		"/api/subscriptions",
		{ method: "POST", body },
	);
	if (ok) revalidateTag("subscriptions", { expire: 0 });
	return NextResponse.json(data, { status });
}
