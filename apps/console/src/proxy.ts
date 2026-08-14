import { type NextRequest, NextResponse } from "next/server";

/**
 * Console access gate (Next proxy convention — Node runtime, so env is read
 * per request, not baked at build). Same rule as the API: open when
 * unconfigured (the loopback / trusted-network case), token-gated the moment
 * the operator sets `CONSOLE_TOKEN` (defaulting to `INSTANCE_TOKEN`) — i.e.
 * whenever the console is reachable beyond their own box.
 */
export default function proxy(request: NextRequest) {
	const gateToken =
		process.env.CONSOLE_TOKEN || process.env.INSTANCE_TOKEN || "";
	if (!gateToken) return NextResponse.next();
	const { pathname } = request.nextUrl;
	if (pathname.endsWith("/token") || pathname.startsWith("/_next")) {
		return NextResponse.next();
	}
	const cookie = request.cookies.get("sl_console")?.value;
	if (cookie === gateToken) return NextResponse.next();
	const url = request.nextUrl.clone();
	url.pathname = "/token";
	url.searchParams.set("next", pathname);
	return NextResponse.redirect(url);
}

export const config = {
	// Everything except Next internals and static assets. The bare "/" entry
	// matters: with a basePath, the compiled pattern for "/((?!…).*)" demands a
	// slash after the prefix, so bare /console would bypass the gate without it.
	matcher: ["/", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
