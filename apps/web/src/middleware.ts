import { appHostname, appUrl } from "@/lib/urls";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Paths that have both marketing (unauthed) and platform (authed) versions
const DUAL_PATHS = ["/subgraphs"];
// Paths that require authentication
const AUTH_REQUIRED = ["/api-keys", "/billing", "/settings", "/admin"];
// Public auth pages — reachable without a session on the app host
const PUBLIC_AUTH_PATHS = ["/login", "/verify"];

function matches(pathname: string, prefixes: string[]): boolean {
	return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
	const session = request.cookies.get("sl_session");
	const { pathname } = request.nextUrl;
	const appHost = appHostname();

	// Host-split disabled (env unset) or unknown host (e.g. Vercel preview):
	// fall back to the single-domain path-based routing.
	if (!appHost) return legacyMiddleware(request, session, pathname);

	const host = request.headers.get("host");
	if (host === appHost) return appHostMiddleware(request, session, pathname);

	// Any other host on a split deployment (apex, www) is marketing.
	return marketingHostMiddleware(request, session, pathname);
}

// app.secondlayer.tools — the authenticated console.
function appHostMiddleware(
	request: NextRequest,
	session: ReturnType<NextRequest["cookies"]["get"]>,
	pathname: string,
) {
	if (matches(pathname, PUBLIC_AUTH_PATHS)) {
		// Already signed in — skip the login screen.
		if (session) return NextResponse.redirect(new URL("/", request.url));
		return NextResponse.next();
	}

	if (!session) {
		return NextResponse.redirect(new URL("/login", request.url));
	}

	if (pathname === "/") {
		return NextResponse.rewrite(new URL("/platform", request.url));
	}

	// /platform/* and /admin/* are served from their own filesystem paths.
	if (pathname === "/platform" || pathname.startsWith("/platform/")) {
		return NextResponse.next();
	}
	if (pathname === "/admin" || pathname.startsWith("/admin/")) {
		return NextResponse.next();
	}

	// Clean console paths -> /platform/* filesystem (admin keeps its own root).
	for (const prefix of [...DUAL_PATHS, ...AUTH_REQUIRED]) {
		if (prefix === "/admin") continue;
		if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
			return NextResponse.rewrite(new URL(`/platform${pathname}`, request.url));
		}
	}

	return NextResponse.next();
}

// secondlayer.tools / www — marketing. Authenticated-only paths bounce to the app host.
function marketingHostMiddleware(
	request: NextRequest,
	_session: ReturnType<NextRequest["cookies"]["get"]>,
	pathname: string,
) {
	const authOnly = ["/platform", ...AUTH_REQUIRED, ...PUBLIC_AUTH_PATHS];
	if (matches(pathname, authOnly)) {
		const search = request.nextUrl.search;
		return NextResponse.redirect(appUrl(`${pathname}${search}`));
	}
	return NextResponse.next();
}

// Pre-split single-domain behavior (Vercel previews, local without env).
function legacyMiddleware(
	request: NextRequest,
	session: ReturnType<NextRequest["cookies"]["get"]>,
	pathname: string,
) {
	if (!session) {
		if (matches(pathname, AUTH_REQUIRED)) {
			return NextResponse.redirect(new URL("/", request.url));
		}
		return NextResponse.next();
	}

	if (pathname === "/") {
		return NextResponse.rewrite(new URL("/platform", request.url));
	}

	if (pathname === "/admin" || pathname.startsWith("/admin/")) {
		return NextResponse.next();
	}

	for (const prefix of [...DUAL_PATHS, ...AUTH_REQUIRED]) {
		if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
			return NextResponse.rewrite(new URL(`/platform${pathname}`, request.url));
		}
	}

	return NextResponse.next();
}

export const config = {
	// Run on everything except API routes (auth/verify must not be redirected,
	// and the Umami proxy /api/send must pass through) and static assets.
	// Note the trailing slash on `api/`: anchoring to the segment is required so
	// clean console paths that merely start with "api" (e.g. /api-keys) still
	// hit the rewrite instead of falling through to a 404.
	matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
