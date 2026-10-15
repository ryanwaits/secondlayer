"use client";

import {
	activeKeys,
	clearAccountData,
	refreshKeys,
	useAccountData,
} from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import { useWebhooksCache } from "@/lib/webhooks-store";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

type Tab = { href: string; label: string; count?: "keys" | "webhooks" };

const TABS: Tab[] = [
	{ href: "/account", label: "Overview" },
	{ href: "/account/keys", label: "API keys", count: "keys" },
	{ href: "/account/credits", label: "Usage and billing" },
	{ href: "/account/webhooks", label: "Webhooks", count: "webhooks" },
];

/** Overview is `/account` itself, so it only matches exactly. */
function isCurrent(pathname: string | null, href: string): boolean {
	if (!pathname) return false;
	if (href === "/account") return pathname === href;
	return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The account pages under one side nav: Overview is home, then keys, usage
 * and billing, and webhooks. The keys and credits flows also open as sheets
 * from the nav's account menu; these pages are the home for them, and where
 * Stripe returns a top-up.
 */
export default function AccountLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { account, loading, logout } = useAuth();
	const pathname = usePathname();
	const { keys } = useAccountData();
	const { list } = useWebhooksCache();
	const signedIn = account !== null;

	// The side nav shows how many keys there are on every account page.
	useEffect(() => {
		if (signedIn) refreshKeys();
	}, [signedIn]);

	const counts = {
		keys: keys === null ? null : activeKeys(keys).length,
		webhooks: list ? list.data.length : null,
	};

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
			<nav className="acct-side" aria-label="Account">
				<p className="acct-side-head">Account</p>
				{TABS.map((t) => (
					<Link
						key={t.href}
						href={t.href}
						className="acct-side-link"
						aria-current={isCurrent(pathname, t.href) ? "page" : undefined}
					>
						{t.label}
						{t.count && counts[t.count] !== null ? (
							<small>{counts[t.count]}</small>
						) : null}
					</Link>
				))}
				{account ? (
					<p className="acct-side-email">{account.email}</p>
				) : (
					<p className="acct-side-email">
						<span
							className="wh-skel"
							aria-hidden="true"
							style={{ display: "inline-block", width: 130, height: 13 }}
						/>
					</p>
				)}
				<button
					type="button"
					className="acct-side-link quiet"
					onClick={() => {
						clearAccountData();
						logout();
					}}
				>
					Sign out
				</button>
			</nav>
			<main className="acct-main">{children}</main>
		</div>
	);
}
