"use client";

import { AccountAvatar, AccountMenu } from "@/components/account-menu";
import { GetStartedMenu } from "@/components/get-started-menu";
import { Logo } from "@/components/logo";
import { useAuth } from "@/lib/auth";
import { PRODUCTS, isActive } from "@/lib/site";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ModeToggle, useDocsDrawer } from "../app/(www)/docs/docs-mode";

/** The five products as a disclosure; same data as the marketing bar. */
function ProductsMenu() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the close trigger
	useEffect(() => setOpen(false), [pathname]);
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			setOpen(false);
			rootRef.current?.querySelector("button")?.focus();
		};
		const onClick = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("click", onClick);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("click", onClick);
		};
	}, [open]);

	return (
		<div className="docs-products" ref={rootRef}>
			<button
				type="button"
				aria-expanded={open}
				aria-controls="docs-products-panel"
				onClick={() => setOpen((v) => !v)}
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
			{open ? (
				<div className="docs-products-panel" id="docs-products-panel">
					{PRODUCTS.map((p) => (
						<Link
							key={p.href}
							href={p.href}
							aria-current={isActive(pathname, p.href) ? "page" : undefined}
						>
							{p.noun}
							<span>{p.verb}</span>
						</Link>
					))}
				</div>
			) : null}
		</div>
	);
}

/**
 * Docs top bar: brand, the ⌘K search trigger (the command palette
 * listens for clicks on `.dash-cmdk`), the Human/Agent switch, site links and
 * session chrome. Sign in never flashes for a session that is already in.
 */
export function DocsTopNav() {
	const { account, loading, logout } = useAuth();
	const { open, setOpen } = useDocsDrawer();

	return (
		<header className="docs-top">
			<div className="docs-top-in">
				<button
					type="button"
					className="docs-burger"
					aria-label="Open docs menu"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
				>
					<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
						<path
							d="M2 4h12M2 8h12M2 12h12"
							stroke="currentColor"
							strokeWidth="1.5"
							fill="none"
						/>
					</svg>
				</button>
				<Link href="/" className="docs-mark" aria-label="secondlayer home">
					<Logo size={22} />
					<span className="docs-mark-name">secondlayer</span>
				</Link>
				<button
					type="button"
					className="docs-search dash-cmdk"
					aria-label="Search docs"
				>
					<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
						<circle
							cx="7"
							cy="7"
							r="5"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
						/>
						<path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.5" />
					</svg>
					<span>
						Search
						<span className="docs-search-long"> docs, commands, endpoints</span>
					</span>
					<kbd>⌘K</kbd>
				</button>
				<ModeToggle />
				<nav className="docs-top-links" aria-label="Site">
					<ProductsMenu />
					<Link href="/pricing">Pricing</Link>
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
						<>
							<Link href="/login">Sign in</Link>
							<GetStartedMenu />
						</>
					)}
				</nav>
			</div>
		</header>
	);
}
