"use client";

import { TerminalFooter } from "@/components/dashboard/shell/terminal-footer";
import { useAuth } from "@/lib/auth";
import { startInsightsPolling } from "@/lib/insights-store";
import { commandForPath } from "@/lib/terminal-command";
import { useWebhooksCache } from "@/lib/webhooks-store";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The account pages frame. The tabs and the chain heartbeat live in the top
 * bar (MarketingNav renders them on /account), Keys lives in the account
 * menu, and a sticky footer names the CLI command for the current view. The
 * keys and credits flows also open as sheets from that menu; these pages are
 * the home for them, and where Stripe returns a top-up.
 */
export default function AccountLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { account, loading } = useAuth();
	const pathname = usePathname();
	const cache = useWebhooksCache();
	const signedIn = Boolean(account);
	// One shared feed of ranked insights for every screen under /account.
	useEffect(() => (signedIn ? startInsightsPolling() : undefined), [signedIn]);
	const command = commandForPath(
		pathname,
		(id) =>
			cache.detail[id]?.data.name ??
			cache.list?.data.find((w) => w.id === id)?.name,
	);

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
			<main className="acct-main">{children}</main>
			{command ? <TerminalFooter command={command} /> : null}
		</div>
	);
}
