"use client";

import { MobileShell } from "@/components/mobile/mobile-shell";
import { useAuth } from "@/lib/auth";
import { warmDashboard } from "@/lib/dashboard-warm";
import { startInsightsPolling } from "@/lib/insights-store";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * The account pages frame. The tabs, the chain heartbeat and the current
 * view's CLI command live in the top bar (MarketingNav renders them on
 * /account), and Keys lives in the account menu. The
 * keys and credits flows also open as sheets from that menu; these pages are
 * the home for them, and where Stripe returns a top-up. On phones (≤640px)
 * the bottom tab bar and large-title header replace the top bar (globals.css
 * hides it).
 */
export default function AccountLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { account, loading } = useAuth();
	const signedIn = Boolean(account);
	// One shared feed of ranked insights for every screen under /account.
	// Insights start with the page, like every screen's own reads: a visitor
	// who turns out to be signed out gets one 401, and the poll stops when
	// the sign-in card replaces the page.
	const mayBeSignedIn = loading || signedIn;
	useEffect(
		() => (mayBeSignedIn ? startInsightsPolling() : undefined),
		[mayBeSignedIn],
	);

	// Once signed in, fill the other tabs' stores when the browser is idle so
	// the current page's own reads go first. Once per page load.
	const pathname = usePathname();
	const pathnameRef = useRef(pathname);
	pathnameRef.current = pathname;
	useEffect(() => {
		if (!signedIn) return;
		const warm = () => warmDashboard(pathnameRef.current);
		if (typeof requestIdleCallback === "function") {
			const id = requestIdleCallback(warm, { timeout: 2000 });
			return () => cancelIdleCallback(id);
		}
		const id = setTimeout(warm, 1500);
		return () => clearTimeout(id);
	}, [signedIn]);

	// Signed out is the one case that still blocks: nothing account-specific
	// ever mounts for a visitor who isn't authenticated. While `loading` is
	// still resolving, though, the shell and its children render right away
	// instead of waiting on `/auth/me` — `children` start their own fetches
	// immediately, and a proxy 401 just reads as "signed out" once loading
	// catches up (each page's own store/notice handling covers that).
	if (!loading && !account) {
		return (
			<div className="login-page">
				<div className="login-card">
					<span className="login-eyebrow">Account</span>
					<h1 className="login-title">Sign in to get a key</h1>
					<p className="login-disclaimer">
						Your API key reads the hosted API at api.secondlayer.tools.
					</p>
					<a href="/signin" className="login-submit account-link-button">
						Sign in
					</a>
				</div>
			</div>
		);
	}

	return (
		<div className="acct-page">
			<MobileShell>
				<main className="acct-main">{children}</main>
			</MobileShell>
		</div>
	);
}
