import {
	ingestRequestHeaders,
	ingestResponseHeaders,
	ingestUpstreamUrl,
} from "@/lib/posthog-ingest";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function forward(request: NextRequest): Promise<Response> {
	let url: string;
	try {
		url = ingestUpstreamUrl(request.nextUrl.pathname, request.nextUrl.search);
	} catch {
		return new Response(null, { status: 404 });
	}
	const hasBody = request.method !== "GET" && request.method !== "HEAD";
	const upstream = await fetch(url, {
		method: request.method,
		headers: ingestRequestHeaders(request.headers),
		body: hasBody ? await request.arrayBuffer() : undefined,
		redirect: "manual",
	});
	return new Response(upstream.body, {
		status: upstream.status,
		headers: ingestResponseHeaders(upstream.headers),
	});
}

export const GET = forward;
export const POST = forward;
export const HEAD = forward;
export const OPTIONS = forward;
