import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The /subgraphs product page is gone — the old marketing URL redirects to its
// docs home. The hosted console moved to apps/console, so the old host-split
// and session-gated rewrites are gone with it.
export function middleware(request: NextRequest) {
	if (request.nextUrl.pathname === "/subgraphs") {
		return NextResponse.redirect(new URL("/docs/subgraphs", request.url));
	}
	return NextResponse.next();
}

export const config = {
	// Exact match only: nested paths like /subgraphs/anything are ordinary
	// routes (or 404s), not redirect targets.
	matcher: ["/subgraphs"],
};
