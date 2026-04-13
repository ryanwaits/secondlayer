import { getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

const API_URL = process.env.SL_API_URL || "http://localhost:3800";

export async function GET(
	req: Request,
	ctx: { params: Promise<{ name: string; runId: string }> },
) {
	const session = getSessionFromRequest(req);
	if (!session) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { name, runId } = await ctx.params;
	const upstreamUrl = `${API_URL}/api/workflows/${name}/runs/${runId}/stream`;

	const upstream = await fetch(upstreamUrl, {
		method: "GET",
		headers: {
			Accept: "text/event-stream",
			Authorization: `Bearer ${session}`,
			"x-sl-origin": "session",
		},
	});

	if (!upstream.ok || !upstream.body) {
		const text = await upstream.text().catch(() => "");
		return NextResponse.json(
			{ error: text || `Upstream HTTP ${upstream.status}` },
			{ status: upstream.status || 502 },
		);
	}

	return new Response(upstream.body, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"x-accel-buffering": "no",
		},
	});
}
