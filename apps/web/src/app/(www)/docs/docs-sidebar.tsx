"use client";

import { Logo } from "@/components/logo";
import { MobileNavCta } from "@/components/mobile-nav-cta";
import apiNav from "@/generated/openapi-nav.json";
import { DOCS_STRIP } from "@/lib/nav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DOCS_NAV } from "./nav";

const API_REFERENCE = "/docs/api-reference";

/** Below the fixed top nav: a section counts as read once its top passes here. */
const ACTIVE_LINE = 140;

/**
 * The section of the reference being read: the last one whose top has passed
 * the line under the top nav. Recomputed per frame on scroll, and set from the
 * hash on navigation so a clicked link is active before the scroll finishes.
 */
function useActiveSection(enabled: boolean): string {
	const [active, setActive] = useState("");
	useEffect(() => {
		if (!enabled) return;
		let frame = 0;
		const compute = () => {
			frame = 0;
			const sections =
				document.querySelectorAll<HTMLElement>(".apiref-section");
			let current = "";
			for (const section of sections) {
				if (section.getBoundingClientRect().top - ACTIVE_LINE > 0) break;
				current = section.id;
			}
			setActive(current);
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(compute);
		};
		const onHash = () => {
			const id = decodeURIComponent(location.hash.slice(1));
			if (document.getElementById(id)?.classList.contains("apiref-section")) {
				setActive(id);
			}
		};
		compute();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("hashchange", onHash);
		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("hashchange", onHash);
			cancelAnimationFrame(frame);
		};
	}, [enabled]);

	// Keep the active row visible inside the sidebar's own scroll area.
	useEffect(() => {
		if (!active) return;
		const row = document.querySelector<HTMLElement>(
			`.docs-nav a[href="#${CSS.escape(active)}"]`,
		);
		const nav = row?.closest<HTMLElement>(".docs-nav");
		if (!row || !nav) return;
		const r = row.getBoundingClientRect();
		const n = nav.getBoundingClientRect();
		if (r.top < n.top + 40 || r.bottom > n.bottom - 40) {
			nav.scrollTop += r.top - n.top - n.height / 3;
		}
	}, [active]);

	return active;
}

/** The reference's endpoint tree, shown under its nav item while it's open.
 *  Tags and endpoints reuse the sidebar's own item and rail classes. */
function ApiReferenceNav({ active }: { active: string }) {
	return (
		<div className="docs-nav-children">
			{apiNav.map((group) => {
				const open = group.endpoints.some((e) => e.anchor === active);
				return (
					<details
						key={group.tag}
						className="apiref-nav-group"
						open={open || undefined}
					>
						<summary className="docs-nav-item docs-nav-child">
							{group.tag.charAt(0).toUpperCase() + group.tag.slice(1)}
						</summary>
						<div className="docs-nav-children">
							{group.endpoints.map((e) => (
								<a
									key={e.anchor}
									href={`#${e.anchor}`}
									className={`docs-nav-item docs-nav-child${e.anchor === active ? " active" : ""}`}
								>
									{e.title}
								</a>
							))}
						</div>
					</details>
				);
			})}
		</div>
	);
}

export function DocsSidebar() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const onReference = pathname === API_REFERENCE;
	const activeSection = useActiveSection(onReference);

	// Bring the current page's row into view on arrival. A row already on
	// screen stays put; one below the fold lands near the top of the sidebar.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — reveal the active row per page
	useEffect(() => {
		const nav = document.querySelector<HTMLElement>(".docs-nav");
		const row = nav?.querySelector<HTMLElement>(
			":scope > .docs-nav-group .docs-nav-branch > .docs-nav-item.active, :scope > .docs-nav-group .docs-nav-child.active",
		);
		if (!nav || !row) return;
		const r = row.getBoundingClientRect();
		const n = nav.getBoundingClientRect();
		if (r.top < n.top || r.bottom > n.bottom) {
			nav.scrollTop += r.top - n.top - 96;
		}
	}, [pathname]);

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
				{/* Site links live up here on mobile (the topnav strip is gone);
				    desktop keeps them in the fixed top nav, so this group hides.
				    Labeled "Site" because that's what it is — Home, Archive, Docs,
				    Blog. It said "Products" until 2026-08, which told a mobile
				    reader our products were "Home" and "Blog". */}
				<div className="docs-nav-group docs-nav-products">
					<div className="docs-nav-grouplabel">Site</div>
					<div className="docs-nav-products-grid">
						{DOCS_STRIP.map((p) => (
							<Link key={p.href} href={p.href} className="docs-nav-item">
								{p.label}
							</Link>
						))}
					</div>
				</div>
				{DOCS_NAV.map((group) => (
					<div className="docs-nav-group" key={group.label}>
						<div className="docs-nav-grouplabel">{group.label}</div>
						{group.items.map((item) => {
							// Sub-pages show only while the reader is somewhere under the
							// parent, so a page with children costs one row like any other
							// until it's the one being read.
							const inSection =
								pathname === item.href || pathname.startsWith(`${item.href}/`);
							return (
								<div key={item.href} className="docs-nav-branch">
									<Link
										href={item.href}
										className={`docs-nav-item${pathname === item.href ? " active" : ""}`}
									>
										{item.title}
									</Link>
									{item.href === API_REFERENCE && onReference ? (
										<ApiReferenceNav active={activeSection} />
									) : null}
									{item.items && inSection && (
										<div className="docs-nav-children">
											{item.items.map((child) => (
												<Link
													key={child.href}
													href={child.href}
													className={`docs-nav-item docs-nav-child${pathname === child.href ? " active" : ""}`}
												>
													{child.title}
												</Link>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				))}
			</aside>
		</>
	);
}
