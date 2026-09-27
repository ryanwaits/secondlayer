"use client";

import { AccountAvatar, AccountMenu } from "@/components/account-menu";
import { GetStartedMenu } from "@/components/get-started-menu";
import { GITHUB_URL, GitHubNavLink } from "@/components/github-nav-link";
import {
	clearAccountData,
	formatUsd,
	useAccountData,
} from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Marketing bar (mock shell): brand left, quiet text links + the GitHub pill
 * right. Fixed 64px with the paper/85 + blur treatment from .marketing-nav.
 * Docs keeps its own chrome — this renders null there; DocsTopNav reuses
 * the same type, GitHub pill, and session chip. The floating AuthBar is
 * hidden wherever this bar is present (globals.css), so the bar owns the
 * top edge alone.
 *
 * The right edge follows the session: signed out gets "Sign in" and the
 * Get started menu (hosted key or self-host install); signed in gets the
 * account chip; while the session check is in flight a blank chip holds the
 * space, so "Sign in" never flashes at someone who is already signed in.
 */
export function MarketingNav({ stars = null }: { stars?: number | null }) {
	const pathname = usePathname();
	const { account, loading, logout } = useAuth();
	const { billing } = useAccountData();
	const [open, setOpen] = useState(false);

	// Close the sheet on navigation and on Escape; lock scroll while open.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the close trigger
	useEffect(() => {
		setOpen(false);
	}, [pathname]);
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
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
		<nav className="marketing-nav" aria-label="Main">
			<Link href="/" className="marketing-nav-brand">
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
			<span className="marketing-nav-spacer" />
			<Link
				href="/archive"
				className="mnav-plain"
				aria-current={pathname === "/archive" ? "page" : undefined}
			>
				Archive
			</Link>
			<Link href="/docs" className="mnav-plain">
				Docs
			</Link>
			<Link
				href="/writing"
				className="mnav-plain"
				aria-current={pathname.startsWith("/writing") ? "page" : undefined}
			>
				Blog
			</Link>
			{!loading && !account ? (
				<Link
					href="/login"
					className="mnav-plain"
					aria-current={pathname === "/login" ? "page" : undefined}
				>
					Sign in
				</Link>
			) : null}
			<GitHubNavLink stars={stars} />
			{loading ? (
				<span className="acct-chip-skeleton" aria-hidden="true" />
			) : account ? (
				<>
					<AccountMenu account={account} onSignOut={logout} />
					<span className="acct-mobile-avatar">
						<AccountAvatar account={account} size={28} />
					</span>
				</>
			) : (
				<GetStartedMenu />
			)}
			<button
				type="button"
				className="mnav-burger"
				aria-expanded={open}
				aria-label={open ? "Close menu" : "Open menu"}
				onClick={() => setOpen((v) => !v)}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					aria-hidden="true"
				>
					{open ? (
						<path d="M3 3l10 10M13 3L3 13" />
					) : (
						<path d="M2 5h12M2 11h12" />
					)}
				</svg>
			</button>
			{open ? (
				<div className="mnav-sheet">
					<Link href="/archive">Archive</Link>
					<Link href="/docs">Docs</Link>
					<Link href="/writing">Blog</Link>
					<a
						href={GITHUB_URL}
						target="_blank"
						rel="noopener noreferrer"
						onClick={() => setOpen(false)}
					>
						GitHub{stars !== null ? ` · ★ ${stars}` : ""}
					</a>
					{account ? (
						<div className="mnav-sheet-account">
							<div className="acct-panel-head">
								<AccountAvatar account={account} size={36} />
								<div className="acct-panel-who">
									<span className="acct-panel-email">{account.email}</span>
									<span className="acct-muted">
										{billing
											? `Balance ${formatUsd(billing.creditsUsdMicros)}`
											: "Hosted account"}
									</span>
								</div>
							</div>
							<Link href="/account/keys" className="acct-btn solid full">
								API keys
							</Link>
							<Link href="/account/credits" className="acct-btn line full">
								Add credits
							</Link>
							<button
								type="button"
								className="mnav-sheet-quiet"
								onClick={() => {
									clearAccountData();
									logout();
								}}
							>
								Sign out
							</button>
						</div>
					) : loading ? null : (
						<div className="mnav-sheet-actions">
							<Link href="/login" className="acct-btn solid full">
								Get an API key
							</Link>
							<Link href="/docs/cli" className="acct-btn line full">
								Install the CLI
							</Link>
							<Link href="/login" className="mnav-sheet-quiet">
								Already have an account? Sign in
							</Link>
						</div>
					)}
				</div>
			) : null}
		</nav>
	);
}
