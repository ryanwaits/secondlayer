import { PLATFORM_API_URL } from "@/lib/api";
import type { NavSubgraph } from "@/lib/nav";

/**
 * Server-only half of the nav — import this from Server Components only.
 *
 * Kept out of lib/nav.ts because that module is reachable from the client
 * nav component, and PLATFORM_API_URL comes from lib/api.ts, which pulls in
 * next/headers. Importing this file from a "use client" module fails the
 * build with a next/headers error, which is the symptom to look for.
 */

interface SubgraphWire {
	name: string;
	visibility: string;
	total_rows: number | null;
}

function compact(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
	return String(n);
}

/**
 * Top public subgraphs by row count, for the Explore panel.
 *
 * Called from the (www) layout so the fetch happens once per render and is
 * shared by every marketing page. Returns [] on any failure — the panel keeps
 * its two static links and renders no live block, so it can never come up
 * empty or take the marketing shell down with the platform API.
 */
export async function fetchNavSubgraphs(limit = 3): Promise<NavSubgraph[]> {
	try {
		const res = await fetch(`${PLATFORM_API_URL}/v1/subgraphs`, {
			next: { revalidate: 300 },
		});
		if (!res.ok) return [];
		const body = (await res.json()) as { subgraphs: SubgraphWire[] };
		return body.subgraphs
			.filter((s) => s.visibility === "public" && s.total_rows !== null)
			.sort((a, b) => (b.total_rows ?? 0) - (a.total_rows ?? 0))
			.slice(0, limit)
			.map((s) => ({ name: s.name, rows: compact(s.total_rows ?? 0) }));
	} catch {
		return [];
	}
}
