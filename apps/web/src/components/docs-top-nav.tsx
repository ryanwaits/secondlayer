"use client";

import { AccountMenu } from "@/components/account-menu";
import { GitHubNavLink } from "@/components/github-nav-link";
import { useAuth } from "@/lib/auth";
import { DOCS_STRIP } from "@/lib/nav";
import Link from "next/link";

/**
 * Product nav for the docs shell — laid out inside the docs grid so it starts
 * at the sidebar's right edge instead of covering it. Type, GitHub pill, and
 * session chrome match the marketing bar; Sign in never flashes for a session
 * that is already in.
 */
export function DocsTopNav({ stars = null }: { stars?: number | null }) {
	const { account, loading, logout } = useAuth();

	return (
		<nav className="docs-topnav" aria-label="Site">
			{DOCS_STRIP.map((p) => (
				<Link
					key={p.href}
					href={p.href}
					className="mnav-plain"
					aria-current={p.href === "/docs" ? "page" : undefined}
				>
					{p.label}
				</Link>
			))}
			{!loading && !account ? (
				<Link href="/login" className="mnav-plain">
					Sign in
				</Link>
			) : null}
			<GitHubNavLink stars={stars} />
			{loading ? (
				<span className="acct-chip-skeleton" aria-hidden="true" />
			) : account ? (
				<AccountMenu account={account} onSignOut={logout} />
			) : null}
		</nav>
	);
}
