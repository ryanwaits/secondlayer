"use client";

import { MobileNavCta } from "@/components/mobile-nav-cta";
import { useAuth } from "@/lib/auth";
import { appHostname, appUrl, marketingUrl } from "@/lib/urls";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export const PRODUCTS = [
	{ label: "Index", href: "/indexes" },
	{ label: "Subgraphs", href: "/subgraphs" },
	{ label: "Streams", href: "/streams" },
	{ label: "Explore", href: "/subgraphs/explore" },
	{ label: "Docs", href: "/docs" },
	{ label: "Pricing", href: "/pricing" },
];

// One Caveat aside in the mobile sheet — the page's single hand-annotation.
const SHEET_NOTES: Record<string, string> = {
	"/subgraphs/explore": "live, no key needed",
};

function isActive(pathname: string, href: string): boolean {
	if (href === "/") return pathname === "/";
	return href === "/subgraphs/explore"
		? pathname.startsWith(href)
		: pathname === href ||
				(pathname.startsWith(`${href}/`) &&
					!pathname.startsWith("/subgraphs/explore"));
}

function Brand({ href = "/" }: { href?: string }) {
	return (
		<Link href={href} className="marketing-nav-brand">
			<svg
				viewBox="4 7 40 28"
				width="22"
				height="15"
				fill="none"
				aria-hidden="true"
			>
				<polygon points="8,25 28,17 42,25 22,33" className="logo-echo" />
				<polygon points="8,19 28,11 42,19 22,27" className="logo-primary" />
			</svg>
			<span>secondlayer</span>
		</Link>
	);
}

/**
 * Top-left product nav for marketing pages — the counterpart to AuthBar
 * (top-right), sharing its mono-uppercase link treatment so the two read
 * as one bar. Docs and platform keep their own chrome: this renders null
 * there (docs has the sidebar shell; platform is outside the (www) group).
 *
 * Below 800px the links give way to a hamburger that opens a full-screen
 * "notebook index" sheet (numbered product list, CTA pinned at the bottom);
 * the floating AuthBar is hidden there and MobileNavCta takes its job.
 */
export function MarketingNav() {
	const pathname = usePathname();
	const { account, loading, logout } = useAuth();
	const [open, setOpen] = useState(false);

	// Product/marketing pages live on the marketing host. When this nav renders
	// on the app host (e.g. the /login page), relative links would resolve to
	// app.* and get bounced by middleware, so cross them to the marketing host.
	// Resolved post-mount to keep SSR + marketing-host output relative (no
	// hydration mismatch, client-side nav preserved on the marketing site).
	const [onAppHost, setOnAppHost] = useState(false);
	useEffect(() => {
		const host = appHostname();
		setOnAppHost(host !== null && window.location.host === host);
	}, []);
	const navHref = (href: string) => (onAppHost ? marketingUrl(href) : href);

	// Close the sheet whenever the route changes (i.e. a link is tapped).
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — close the sheet on navigation
	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	// Close on Escape and lock body scroll while the sheet is open.
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("keydown", onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prev;
		};
	}, [open]);

	if (pathname.startsWith("/docs")) return null;

	return (
		<>
			<nav className="marketing-nav" aria-label="Products">
				<Brand href={navHref("/")} />
				{PRODUCTS.map((p) => (
					<Link
						key={p.href}
						href={navHref(p.href)}
						className="auth-bar-nav-link marketing-nav-link"
						aria-current={isActive(pathname, p.href) ? "page" : undefined}
					>
						<span className="auth-bar-nav-label">{p.label}</span>
					</Link>
				))}
				<span className="marketing-nav-spacer" aria-hidden="true" />
				<MobileNavCta className="auth-bar-cta mnav-bar-cta" />
				<button
					type="button"
					className="mnav-burger"
					aria-label="Open navigation"
					aria-expanded={open}
					onClick={() => setOpen(true)}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M2.5 5.5h11M2.5 10.5h11"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
				</button>
			</nav>

			{open && (
				<div className="mnav-sheet">
					<div className="mnav-sheet-bar">
						<Brand href={navHref("/")} />
						<button
							type="button"
							className="mnav-close"
							onClick={() => setOpen(false)}
						>
							Close ✕
						</button>
					</div>
					<nav className="mnav-list" aria-label="Products">
						{PRODUCTS.map((p, i) => (
							<Link
								key={p.href}
								href={navHref(p.href)}
								className={`mnav-row${isActive(pathname, p.href) ? " active" : ""}`}
							>
								<span className="no">{String(i + 1).padStart(2, "0")}</span>
								<span className="nm">{p.label}</span>
								{SHEET_NOTES[p.href] && (
									<span className="mnav-note" aria-hidden="true">
										{SHEET_NOTES[p.href]}
									</span>
								)}
							</Link>
						))}
					</nav>
					{!loading && (
						<div className="mnav-foot">
							{account ? (
								<>
									<Link href={appUrl("/")} className="mnav-cta">
										Platform
									</Link>
									<button
										type="button"
										className="mnav-login"
										onClick={() => logout()}
									>
										Log out
									</button>
								</>
							) : (
								<>
									<Link href={appUrl("/login")} className="mnav-cta">
										Get an API key
									</Link>
									<Link href={appUrl("/login")} className="mnav-login">
										Sign in
									</Link>
								</>
							)}
						</div>
					)}
				</div>
			)}
		</>
	);
}
