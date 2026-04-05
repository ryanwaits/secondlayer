import { getSessionFromRequest } from "@/lib/api";
import { loadMessages } from "@/lib/sessions/persistence";
import { NextResponse } from "next/server";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const messages = await loadMessages(sessionToken, id);
	return NextResponse.json({ messages });
}
