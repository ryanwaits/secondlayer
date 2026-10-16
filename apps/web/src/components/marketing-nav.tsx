"use client";

import { AccountAvatar, AccountMenu } from "@/components/account-menu";
import { countByDisplayStatus } from "@/components/account/webhooks/shared";
import {
	DASHBOARD_TABS,
	DashboardTabs,
} from "@/components/dashboard/shell/dashboard-tabs";
import { ViewCommand } from "@/components/dashboard/shell/view-command";
import { Logo } from "@/components/logo";
import { ProductsMenu } from "@/components/products-menu";
import {
	clearAccountData,
	formatUsd,
	useAccountData,
} from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import { PRODUCTS, SITE_LINKS, isActive } from "@/lib/site";
import { commandForPath } from "@/lib/terminal-command";
import { useWebhooksCache } from "@/lib/webhooks-store";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Marketing bar: brand, a Products menu (the five products), Verify, Pricing,
 * Docs, Blog; Sign in + Start free on the right. Fixed 64px. Docs keeps its
 * own chrome, so this renders null there. The floating AuthBar is hidden
 * wherever this bar is present (globals.css), so the bar owns the top edge.
 *
 * The right edge follows the session: signed out gets "Sign in" and the
 * Start free menu (hosted key or self-host install); signed in gets the
 * account chip; while the session check is in flight a blank chip holds the
 * space, so "Sign in" never flashes at someone who is already signed in.
 *
 * On /account the center links give way to the dashboard tabs, and the chain
 * heartbeat and a ⌘K hint lead the right edge.
 */
export function MarketingNav() {
	const pathname = usePathname();
	const { account, loading, logout } = useAuth();
	const { billing } = useAccountData();
	const { list, detail } = useWebhooksCache();
	const [open, setOpen] = useState(false);

	// Close the sheet on navigation; Escape closes it and scroll locks while
	// it is open.
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

	// Hold the dashboard bar through the session check so the marketing links
	// never flash on /account.
	const onAccount = pathname === "/account" || pathname.startsWith("/account/");
	const dash = onAccount && (loading || account !== null);
	const failingWebhooks = list
		? countByDisplayStatus(list.data, "error")
		: undefined;
	const command = dash
		? commandForPath(
				pathname,
				(id) =>
					detail[id]?.data.name ?? list?.data.find((w) => w.id === id)?.name,
			)
		: null;

	return (
		<nav
			className={dash ? "marketing-nav is-dash" : "marketing-nav"}
			aria-label="Main"
		>
			<Link href="/" className="marketing-nav-brand">
				<Logo size={22} />
				<span>secondlayer</span>
			</Link>
			{dash ? (
				<DashboardTabs pathname={pathname} failingWebhooks={failingWebhooks} />
			) : (
				<>
					<div className="mnav-links">
						<ProductsMenu className="mnav-products" />
						{SITE_LINKS.map((l) => (
							<Link
								key={l.href}
								href={l.href}
								className="mnav-plain"
								aria-current={isActive(pathname, l.href) ? "page" : undefined}
							>
								{l.label}
							</Link>
						))}
					</div>
					<span className="marketing-nav-spacer" />
				</>
			)}
			<div className="mnav-right">
				{dash && command ? <ViewCommand command={command} /> : null}
				{!loading && !account ? (
					<Link
						href="/signin"
						className="mnav-plain"
						aria-current={pathname === "/signin" ? "page" : undefined}
					>
						Sign in
					</Link>
				) : null}
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
					<Link href="/signin" className="start-free">
						Start free
					</Link>
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
			</div>
			{open ? (
				<div className="mnav-sheet">
					<p className="mnav-sheet-label">Products</p>
					{PRODUCTS.map((p) => (
						<Link key={p.href} href={p.href} className="mnav-sheet-product">
							{p.noun}
						</Link>
					))}
					<p className="mnav-sheet-label">More</p>
					{SITE_LINKS.map((l) => (
						<Link key={l.href} href={l.href}>
							{l.label}
						</Link>
					))}
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
							{dash ? (
								DASHBOARD_TABS.filter((t) => t.ready).map((t) => (
									<Link
										key={t.href}
										href={t.href}
										onClick={() => setOpen(false)}
									>
										{t.label}
									</Link>
								))
							) : (
								<Link href="/account" className="acct-btn solid full">
									Dashboard
								</Link>
							)}
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
							<Link href="/signin" className="acct-btn solid full">
								Get an API key
							</Link>
							<Link href="/docs/cli" className="acct-btn line full">
								Install the CLI
							</Link>
							<Link href="/signin" className="mnav-sheet-quiet">
								Already have an account? Sign in
							</Link>
						</div>
					)}
				</div>
			) : null}
		</nav>
	);
}
