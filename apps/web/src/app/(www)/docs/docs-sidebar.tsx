"use client";

import { Logo } from "@/components/console/logo";
import { PRODUCTS } from "@/components/marketing-nav";
import { MobileNavCta } from "@/components/mobile-nav-cta";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DOCS_NAV } from "./nav";

export function DocsSidebar() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);

	// Close the mobile drawer whenever the route changes (i.e. a link is tapped).
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — close the drawer on navigation
	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	// Close on Escape while the drawer is open.
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	return (
		<>
			{/* Mobile bar: burger · wordmark · CTA. Replaces the topnav strip and
			    the floating AuthBar below 768px; hidden on desktop. */}
			<div className="docs-mobilebar">
				<Link href="/" className="docs-mobilebar-brand">
					<Logo size={22} />
					<span>secondlayer</span>
				</Link>
				<MobileNavCta className="auth-bar-cta docs-mobilebar-cta" />
				<button
					type="button"
					className="docs-burger"
					aria-label="Open navigation"
					aria-expanded={open}
					onClick={() => setOpen(true)}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M2.5 5.5h11M2.5 10.5h11"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
				</button>
			</div>
			{open && (
				<button
					type="button"
					className="docs-nav-overlay"
					aria-label="Close navigation"
					onClick={() => setOpen(false)}
				/>
			)}
			<aside className={`docs-nav${open ? " open" : ""}`}>
				<Link href="/" className="docs-nav-brand page-title-with-logo">
					<Logo size={22} />
					<span>secondlayer</span>
				</Link>
				{/* Product links live up here on mobile (the topnav strip is gone);
				    desktop keeps them in the fixed top nav, so this group hides. */}
				<div className="docs-nav-group docs-nav-products">
					<div className="docs-nav-grouplabel">Products</div>
					<div className="docs-nav-products-grid">
						{PRODUCTS.filter((p) => p.href !== "/docs").map((p) => (
							<Link key={p.href} href={p.href} className="docs-nav-item">
								{p.label}
							</Link>
						))}
					</div>
				</div>
				{DOCS_NAV.map((group) => (
					<div className="docs-nav-group" key={group.label}>
						<div className="docs-nav-grouplabel">{group.label}</div>
						{group.items.map((item) => (
							<Link
								key={item.href}
								href={item.href}
								className={`docs-nav-item${pathname === item.href ? " active" : ""}`}
							>
								{item.title}
							</Link>
						))}
					</div>
				))}
			</aside>
		</>
	);
}
