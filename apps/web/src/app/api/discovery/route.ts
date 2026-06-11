import { PLATFORM_API_URL } from "@/lib/api";
import { NextResponse } from "next/server";

/**
 * Same-origin proxy for the public subgraph discovery JSON, so the command
 * center's one prefetch stays first-party. Short shared cache: discovery
 * changes on deploy/publish, not per-request.
 */
export async function GET() {
	try {
		const res = await fetch(`${PLATFORM_API_URL}/v1/subgraphs`, {
			next: { revalidate: 30 },
		});
		if (!res.ok) {
			return NextResponse.json({ subgraphs: [] }, { status: 200 });
		}
		const data = await res.json();
		return NextResponse.json(data, {
			headers: { "Cache-Control": "public, max-age=30" },
		});
	} catch {
		return NextResponse.json({ subgraphs: [] }, { status: 200 });
	}
}
