"use client";

import { useAuth } from "@/lib/auth";
import { appHostname } from "@/lib/urls";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const PLATFORM_PATHS = ["/platform", "/api-keys", "/billing", "/settings"];
const DUAL_PATHS = ["/subgraphs"];

export function AuthBar() {
	const { account, loading, logout } = useAuth();
	const pathname = usePathname();
	const router = useRouter();

	const isDualPath = DUAL_PATHS.some(
		(p) => pathname === p || pathname.startsWith(`${p}/`),
	);
	const appHost = appHostname();
	const isAppHost =
		appHost === null ||
		(typeof window !== "undefined" && window.location.host === appHost);
	const isPlatform =
		(isAppHost && (pathname === "/" || isDualPath) && !!account) ||
		PLATFORM_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement
			)
				return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key === "d" || e.key === "D") router.push("/docs");
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [router]);

	if (loading) return null;
	if (isPlatform) return null;
	// The docs shell's top strip already carries Home/Docs/Archive/Blog/GitHub.
	if (pathname.startsWith("/docs")) return null;

	if (account) {
		return (
			<div className="auth-bar">
				<button
					type="button"
					className="auth-bar-login"
					onClick={() => logout()}
				>
					Sign out
				</button>
			</div>
		);
	}

	return (
		<div className="auth-bar">
			<Link href="/docs" className="auth-bar-nav-link">
				<span className="auth-bar-nav-label">Docs</span>
			</Link>
			<a
				href="https://github.com/ryanwaits/secondlayer"
				className="auth-bar-cta"
				target="_blank"
				rel="noopener noreferrer"
			>
				GitHub
			</a>
		</div>
	);
}
