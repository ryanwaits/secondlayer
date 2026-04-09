import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
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

	try {
		const { name } = await params;
		let body: unknown;
		try {
			body = await req.json();
		} catch {
			body = undefined;
		}
		const data = await apiRequest(`/api/workflows/${name}/trigger`, {
			method: "POST",
			body,
			sessionToken,
		});
		revalidateTag("workflows", { expire: 0 });
		revalidateTag(`workflow-${name}`, { expire: 0 });
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
