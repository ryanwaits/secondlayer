import { type NextRequest, NextResponse } from "next/server";

/**
 * Console access gate. Same rule as the API: open when unconfigured (the
 * loopback / trusted-network case), token-gated the moment the operator sets
 * `CONSOLE_TOKEN` (defaulting to `INSTANCE_TOKEN`) — i.e. whenever the
 * console is reachable beyond their own box.
 */
const GATE_TOKEN =
	process.env.CONSOLE_TOKEN || process.env.INSTANCE_TOKEN || "";

export function middleware(request: NextRequest) {
	if (!GATE_TOKEN) return NextResponse.next();
	const { pathname } = request.nextUrl;
	if (pathname.endsWith("/token") || pathname.startsWith("/_next")) {
		return NextResponse.next();
	}
	const cookie = request.cookies.get("sl_console")?.value;
	if (cookie === GATE_TOKEN) return NextResponse.next();
	const url = request.nextUrl.clone();
	url.pathname = "/token";
	url.searchParams.set("next", pathname);
	return NextResponse.redirect(url);
}

export const config = {
	// Everything except Next internals and static assets.
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
