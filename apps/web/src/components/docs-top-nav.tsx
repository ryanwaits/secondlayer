"use client";

import { AccountAvatar, AccountMenu } from "@/components/account-menu";
import { GetStartedMenu } from "@/components/get-started-menu";
import { Logo } from "@/components/logo";
import { ProductsMenu } from "@/components/products-menu";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { ModeToggle, useDocsDrawer } from "../app/(www)/docs/docs-mode";

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
					<ProductsMenu className="docs-products" />
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
