import { getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

const API_URL = process.env.SL_API_URL || "http://localhost:3800";

export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const res = await fetch(
			`${API_URL}/api/chat-sessions?limit=10`,
			{ headers: { Authorization: `Bearer ${sessionToken}` } },
		);
		if (!res.ok) return NextResponse.json({ sessions: [] });
		const data = await res.json();
		return NextResponse.json({ sessions: data.sessions ?? [] });
	} catch {
		return NextResponse.json({ sessions: [] });
	}
}
