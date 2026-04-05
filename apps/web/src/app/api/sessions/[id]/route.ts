import { getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

const API_URL = process.env.SL_API_URL || "http://localhost:3800";

export async function DELETE(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;

	try {
		await fetch(`${API_URL}/api/chat-sessions/${id}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${sessionToken}` },
		});
		return NextResponse.json({ ok: true });
	} catch {
		return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
	}
}
