import { getSessionFromRequest } from "@/lib/api";
import { fetchFromTenant } from "@/lib/tenant-api";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

interface RouteParams {
	params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const { id } = await params;
	const { ok, status, data } = await fetchFromTenant(
		sessionToken,
		`/api/subscriptions/${id}`,
	);
	return NextResponse.json(data, { status: ok ? 200 : status });
}

export async function PATCH(req: Request, { params }: RouteParams) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const { id } = await params;
	const body = await req.json().catch(() => null);
	if (!body) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}
	const { ok, status, data } = await fetchFromTenant(
		sessionToken,
		`/api/subscriptions/${id}`,
		{ method: "PATCH", body },
	);
	if (ok) revalidateTag("subscriptions", { expire: 0 });
	return NextResponse.json(data, { status });
}

export async function DELETE(req: Request, { params }: RouteParams) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const { id } = await params;
	const { ok, status, data } = await fetchFromTenant(
		sessionToken,
		`/api/subscriptions/${id}`,
		{ method: "DELETE" },
	);
	if (ok) revalidateTag("subscriptions", { expire: 0 });
	return NextResponse.json(data, { status });
}
