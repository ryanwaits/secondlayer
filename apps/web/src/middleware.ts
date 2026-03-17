import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Paths that have both marketing (unauthed) and platform (authed) versions
const DUAL_PATHS = ["/streams", "/views"];
// Paths that require authentication
const AUTH_REQUIRED = ["/api-keys", "/usage", "/billing", "/settings"];

export function middleware(request: NextRequest) {
  const session = request.cookies.get("sl_session");
  const { pathname } = request.nextUrl;

  // /site/* → serve marketing pages even when authenticated
  if (pathname.startsWith("/site")) {
    const target = pathname.replace(/^\/site/, "") || "/";
    return NextResponse.rewrite(new URL(target, request.url));
  }

  if (!session) {
    if (AUTH_REQUIRED.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // Authenticated: rewrite to /platform/* (internal filesystem routing)
  if (pathname === "/") {
    return NextResponse.rewrite(new URL("/platform", request.url));
  }



  for (const prefix of [...DUAL_PATHS, ...AUTH_REQUIRED]) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return NextResponse.rewrite(
        new URL("/platform" + pathname, request.url),
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/site/:path*", "/streams", "/streams/:path*", "/views", "/views/:path*", "/api-keys", "/api-keys/:path*", "/usage", "/usage/:path*", "/billing", "/billing/:path*", "/settings", "/settings/:path*"],
};
