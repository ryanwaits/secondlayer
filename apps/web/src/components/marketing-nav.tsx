"use client";

import { AccountAvatar, AccountMenu } from "@/components/account-menu";
import { GetStartedMenu } from "@/components/get-started-menu";
import { Logo } from "@/components/logo";
import {
	clearAccountData,
	formatUsd,
	useAccountData,
} from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import { PRODUCTS, SITE_LINKS, isActive } from "@/lib/site";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
 */
export function MarketingNav() {
	const pathname = usePathname();
	const { account, loading, logout } = useAuth();
	const { billing } = useAccountData();
	const [open, setOpen] = useState(false);
	const [productsOpen, setProductsOpen] = useState(false);
	const productsRef = useRef<HTMLDivElement>(null);
	const onProduct = PRODUCTS.some((p) => isActive(pathname, p.href));

	// Close menus on navigation; Escape and outside click close the Products
	// panel; Escape closes the sheet and scroll locks while it is open.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the close trigger
	useEffect(() => {
		setOpen(false);
		setProductsOpen(false);
	}, [pathname]);
	useEffect(() => {
		if (!productsOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setProductsOpen(false);
				productsRef.current?.querySelector("button")?.focus();
			}
		};
		const onClick = (e: MouseEvent) => {
			if (!productsRef.current?.contains(e.target as Node))
				setProductsOpen(false);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("click", onClick);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("click", onClick);
		};
	}, [productsOpen]);
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
				<Logo size={22} />
				<span>secondlayer</span>
			</Link>
			<div className="mnav-links">
				<div className="mnav-products" ref={productsRef}>
					<button
						type="button"
						className="mnav-products-btn"
						aria-expanded={productsOpen}
						aria-controls="mnav-products-panel"
						aria-current={onProduct ? "true" : undefined}
						onClick={() => setProductsOpen((v) => !v)}
					>
						Products
						<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
							<path
								d="M2 3.5 5 6.5 8 3.5"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.3"
							/>
						</svg>
					</button>
					{productsOpen ? (
						<div className="mnav-products-panel" id="mnav-products-panel">
							{PRODUCTS.map((p) => (
								<Link
									key={p.href}
									href={p.href}
									className="mnav-products-item"
									aria-current={isActive(pathname, p.href) ? "page" : undefined}
								>
									{p.noun}
									<span className="v">{p.verb}</span>
									<span className="l">{p.line}</span>
								</Link>
							))}
						</div>
					) : null}
				</div>
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
			<div className="mnav-right">
				{!loading && !account ? (
					<Link
						href="/login"
						className="mnav-plain"
						aria-current={pathname === "/login" ? "page" : undefined}
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
			</div>
			{open ? (
				<div className="mnav-sheet">
					<p className="mnav-sheet-label">Products</p>
					{PRODUCTS.map((p) => (
						<Link key={p.href} href={p.href} className="mnav-sheet-product">
							{p.noun}
							<span className="v">{p.verb}</span>
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
