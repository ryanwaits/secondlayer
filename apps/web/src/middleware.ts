import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Paths that have both marketing (unauthed) and platform (authed) versions
const DUAL_PATHS = ["/streams", "/subgraphs", "/marketplace", "/workflows"];
// Paths that require authentication
const AUTH_REQUIRED = [
	"/api-keys",
	"/usage",
	"/team",
	"/settings",
	"/sessions",
	"/admin",
];

export function middleware(request: NextRequest) {
	const session = request.cookies.get("sl_session");
	const { pathname } = request.nextUrl;

	// /site/* -> serve marketing pages even when authenticated
	if (pathname.startsWith("/site")) {
		const target = pathname.replace(/^\/site/, "") || "/";
		return NextResponse.rewrite(new URL(target, request.url));
	}

	// Redirect old /agents URLs to /workflows
	if (pathname === "/agents" || pathname.startsWith("/agents/")) {
		return NextResponse.redirect(
			new URL(pathname.replace("/agents", "/workflows"), request.url),
		);
	}

	if (!session) {
		if (
			AUTH_REQUIRED.some((p) => pathname === p || pathname.startsWith(`${p}/`))
		) {
			return NextResponse.redirect(new URL("/", request.url));
		}
		return NextResponse.next();
	}

	// Authenticated: rewrite to /platform/* (internal filesystem routing)
	if (pathname === "/") {
		return NextResponse.rewrite(new URL("/platform", request.url));
	}

	// Admin stays at /admin (no /platform rewrite)
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
	matcher: [
		"/",
		"/site/:path*",
		"/streams",
		"/streams/:path*",
		"/subgraphs",
		"/subgraphs/:path*",
		"/api-keys",
		"/api-keys/:path*",
		"/usage",
		"/usage/:path*",
		"/team",
		"/team/:path*",
		"/settings",
		"/settings/:path*",
		"/sessions",
		"/sessions/:path*",
		"/workflows",
		"/workflows/:path*",
		"/marketplace",
		"/marketplace/:path*",
		"/admin",
		"/admin/:path*",
	],
};
