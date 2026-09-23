"use client";

import { MarketingNav } from "@/components/marketing-nav";
import { clearAccountData } from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
	{ href: "/account/keys", label: "API keys" },
	{ href: "/account/credits", label: "Credits" },
];

/**
 * The account pages: API keys and Credits under one side nav. The same flows
 * also open as sheets from the nav's account menu; these pages are the home
 * for them, and where Stripe returns a top-up.
 */
export default function AccountLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { account, loading, logout } = useAuth();
	const pathname = usePathname();

	if (loading) {
		return (
			<div className="www">
				<MarketingNav />
			</div>
		);
	}

	if (!account) {
		return (
			<div className="login-page">
				<MarketingNav />
				<div className="login-card">
					<span className="login-eyebrow">Account</span>
					<h1 className="login-title">Sign in to get a key</h1>
					<p className="login-disclaimer">
						Your API key reads the hosted API at api.secondlayer.tools.
					</p>
					<a href="/login" className="login-submit account-link-button">
						Sign in
					</a>
				</div>
			</div>
		);
	}

	return (
		<div className="www">
			<MarketingNav />
			<div className="acct-page">
				<nav className="acct-side" aria-label="Account">
					<p className="acct-side-head">Account</p>
					{TABS.map((t) => (
						<Link
							key={t.href}
							href={t.href}
							className="acct-side-link"
							aria-current={pathname === t.href ? "page" : undefined}
						>
							{t.label}
						</Link>
					))}
					<p className="acct-side-email">{account.email}</p>
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
		</div>
	);
}
