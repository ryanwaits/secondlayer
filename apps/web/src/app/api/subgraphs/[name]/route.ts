import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
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

	try {
		const data = await apiRequest(`/api/subgraphs/${name}`, { sessionToken });
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
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

	try {
		const data = await apiRequest<{ message: string }>(
			`/api/subgraphs/${name}`,
			{ method: "DELETE", sessionToken },
		);
		revalidateTag("subgraphs", { expire: 0 });
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
