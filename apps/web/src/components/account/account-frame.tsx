"use client";

import { MobileShell } from "@/components/mobile/mobile-shell";
import { useAuth } from "@/lib/auth";
import {
	insightsHold,
	insightsSnapshot,
	startInsightsPolling,
} from "@/lib/insights-store";
import { useEffect, useSyncExternalStore } from "react";

/**
 * The account pages frame. The tabs, the chain heartbeat and the current
 * view's CLI command live in the top bar (MarketingNav renders them on
 * /account), and Keys lives in the account menu. The
 * keys and credits flows also open as sheets from that menu; these pages are
 * the home for them, and where Stripe returns a top-up. On phones (≤640px)
 * the bottom tab bar and large-title header replace the top bar (globals.css
 * hides it).
 */
export function AccountFrame({
	children,
	signedOut = false,
}: {
	children: React.ReactNode;
	/** The server saw no session cookie: the sign-in card is in the HTML and
	 *  no page mounts. An expired cookie still falls back to `/auth/me` below. */
	signedOut?: boolean;
}) {
	const { account, loading } = useAuth();
	const signedIn = Boolean(account);
	// One shared feed of ranked insights for every screen under /account.
	// Insights start with the page, like every screen's own reads: a visitor
	// who turns out to be signed out gets one 401, and the poll stops when
	// the sign-in card replaces the page. A page that rendered its insights on
	// the server has already put them in the store (children render before
	// this effect runs), so the poll then waits a full interval.
	const mayBeSignedIn = !signedOut && (loading || signedIn);
	// The page's insights may still be streaming in: the first fetch waits for
	// its seed, and the seed (or leaving the route) re-runs this effect.
	const held = useSyncExternalStore(
		insightsHold.subscribe,
		insightsHold.epoch,
		() => 0,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `held` re-runs this when the hold-back ends
	useEffect(
		() =>
			mayBeSignedIn
				? startInsightsPolling({
						immediate:
							!insightsHold.active() && insightsSnapshot().status === "idle",
					})
				: undefined,
		[mayBeSignedIn, held],
	);

	// Signed out is the one case that still blocks: nothing account-specific
	// ever mounts for a visitor who isn't authenticated. While `loading` is
	// still resolving, though, the shell and its children render right away
	// instead of waiting on `/auth/me` — `children` start their own fetches
	// immediately, and a proxy 401 just reads as "signed out" once loading
	// catches up (each page's own store/notice handling covers that).
	if (signedOut || (!loading && !account)) {
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
