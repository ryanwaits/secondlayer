import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const { id } = await params;
		const data = await apiRequest(`/api/streams/${id}`, { sessionToken });
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}

export async function PATCH(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const { id } = await params;
		const body = await req.json();
		const data = await apiRequest(`/api/streams/${id}`, {
			method: "PATCH",
			body,
			sessionToken,
		});
		revalidateTag("streams", { expire: 0 });
		revalidateTag(`stream-${id}`, { expire: 0 });
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
	{ params }: { params: Promise<{ id: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const { id } = await params;
		const data = await apiRequest(`/api/streams/${id}`, {
			method: "DELETE",
			sessionToken,
		});
		revalidateTag("streams", { expire: 0 });
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
