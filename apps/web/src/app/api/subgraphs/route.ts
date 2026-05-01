import { getSessionFromRequest } from "@/lib/api";
import { fetchFromTenant } from "@/lib/tenant-api";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { ok, status, data } = await fetchFromTenant<{ data: unknown[] }>(
		sessionToken,
		"/api/subgraphs",
	);
	return NextResponse.json(data, { status: ok ? 200 : status });
}

export async function POST(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const { ok, status, data } = await fetchFromTenant(
		sessionToken,
		"/api/subgraphs",
		{
			method: "POST",
			headers: { "x-sl-origin": "session" },
			body,
		},
	);
	return NextResponse.json(data, { status: ok ? 200 : status });
}
