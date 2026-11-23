"use client";

import { MobileShell } from "@/components/mobile/mobile-shell";
import { SessionUnreachable } from "@/components/session-unreachable";
import { useAuth } from "@/lib/auth";
import { insightsSnapshot, startInsightsPolling } from "@/lib/insights-store";
import { useEffect } from "react";

export function AccountFrame({
	children,
	signedOut = false,
}: {
	children: React.ReactNode;
	signedOut?: boolean;
}) {
	const { account, loading, unreachable } = useAuth();
	const signedIn = Boolean(account);
	// One shared feed of ranked insights for every screen under /account.
	// Insights start with the page, like every screen's own reads: a visitor
	// who turns out to be signed out gets one 401, and the poll stops when
	// the sign-in card replaces the page. A page that rendered its insights on
	// the server has already put them in the store (children render before
	// this effect runs), so the poll then waits a full interval.
	const mayBeSignedIn = !signedOut && (loading || signedIn);
	useEffect(
		() =>
			mayBeSignedIn
				? startInsightsPolling({
						immediate: insightsSnapshot().status === "idle",
					})
				: undefined,
		[mayBeSignedIn],
	);

	// Signed out is the one case that still blocks: nothing account-specific
	// ever mounts for a visitor who isn't authenticated. While `loading` is
	// still resolving, though, the shell and its children render right away
	// instead of waiting on `/auth/me` — `children` start their own fetches
	// immediately, and a proxy 401 just reads as "signed out" once loading
	// catches up (each page's own store/notice handling covers that).
	if (unreachable && !signedOut) return <SessionUnreachable />;
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
