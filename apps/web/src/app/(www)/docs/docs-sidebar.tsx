"use client";

import { clearAccountData } from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import { DOCS_STRIP } from "@/lib/nav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useDocsDrawer } from "./docs-drawer";
import { DOCS_NAV } from "./nav";

/** Gap kept between a revealed row and the sidebar's edge. */
const REVEAL_MARGIN = 8;

/**
 * Scrolls the sidebar only if `row` is not fully inside it, and only by the
 * distance that brings it just inside (never re-centres), so rows that are
 * already visible never move when the active section changes.
 */
function revealNearest(nav: HTMLElement, row: HTMLElement) {
	const r = row.getBoundingClientRect();
	const n = nav.getBoundingClientRect();
	if (r.top < n.top) nav.scrollTop -= n.top + REVEAL_MARGIN - r.top;
	else if (r.bottom > n.bottom) {
		nav.scrollTop += r.bottom - (n.bottom - REVEAL_MARGIN);
	}
}

interface Head {
	id: string;
	text: string;
	/** Endpoints under an API family heading. */
	count?: string;
}

/** The open page's visible h2s, listed under its row. Reads them from the
 *  rendered article (rehype-slug gives stable ids), skips any inside a
 *  collapsed `<details>`, and marks the topmost one in view as the place being
 *  read. */
function PageOutline({ onNavigate }: { onNavigate: () => void }) {
	const pathname = usePathname();
	const [heads, setHeads] = useState<Head[]>([]);
	const [activeId, setActiveId] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — re-read headings on route change
	useEffect(() => {
		const article = document.getElementById("docs-article");
		const found = Array.from(
			article?.querySelectorAll<HTMLElement>("h2[id]") ?? [],
		)
			.filter((h) => !h.closest("details"))
			.map((h) => ({
				id: h.id,
				text: h.dataset.outline ?? h.textContent ?? "",
				count: h.dataset.count,
			}));
		setHeads(found);
		setActiveId(found[0]?.id ?? "");
	}, [pathname]);

	// Scrollspy: the topmost heading in view is the active one.
	useEffect(() => {
		if (heads.length === 0) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries.filter((e) => e.isIntersecting);
				if (visible.length === 0) return;
				const top = visible.reduce((a, b) =>
					a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
				);
				setActiveId(top.target.id);
			},
			{ rootMargin: "-80px 0px -65% 0px", threshold: 0 },
		);
		for (const h of heads) {
			const el = document.getElementById(h.id);
			if (el) observer.observe(el);
		}
		return () => observer.disconnect();
	}, [heads]);

	if (heads.length === 0) return null;
	return (
		<div className="docs-nav-outline">
			{heads.map((h) => (
				<a
					key={h.id}
					href={`#${h.id}`}
					aria-current={h.id === activeId ? "location" : undefined}
					className={h.id === activeId ? "active" : undefined}
					onClick={onNavigate}
				>
					{h.text}
					{h.count ? <span className="docs-nav-count">{h.count}</span> : null}
				</a>
			))}
		</div>
	);
}

export function DocsSidebar() {
	const pathname = usePathname();
	const { account, loading, logout } = useAuth();
	const { open, setOpen } = useDocsDrawer();
	// A hash click doesn't change the route, so the phone drawer closes here.
	const outline = <PageOutline onNavigate={() => setOpen(false)} />;

	// Bring the current page's row into view on arrival. A row already on
	// screen stays put; one off screen moves in by the least distance.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — reveal the active row per page
	useEffect(() => {
		const nav = document.querySelector<HTMLElement>(".docs-nav");
		const row = nav?.querySelector<HTMLElement>(
			":scope > .docs-nav-group .docs-nav-branch > .docs-nav-item.active",
		);
		if (!nav || !row) return;
		revealNearest(nav, row);
	}, [pathname]);

	// Close the mobile drawer whenever the route changes (i.e. a link is tapped).
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — close the drawer on navigation
	useEffect(() => {
		setOpen(false);
	}, [pathname, setOpen]);

	// Close on Escape while the drawer is open.
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, setOpen]);

	return (
		<>
			{open && (
				<button
					type="button"
					className="docs-nav-overlay"
					aria-label="Close navigation"
					onClick={() => setOpen(false)}
				/>
			)}
			<aside className={`docs-nav${open ? " open" : ""}`}>
				{/* Site links live up here on mobile (the top bar's links are gone);
				    desktop keeps them in the top bar, so this group hides.
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
						{!loading && !account ? (
							<Link href="/login" className="docs-nav-item">
								Sign in
							</Link>
						) : null}
						{account ? (
							<Link href="/account/keys" className="docs-nav-item">
								Account
							</Link>
						) : null}
						{account ? (
							<button
								type="button"
								className="docs-nav-item"
								onClick={() => {
									clearAccountData();
									logout();
								}}
							>
								Sign out
							</button>
						) : null}
					</div>
				</div>
				{DOCS_NAV.map((group) => (
					<div className="docs-nav-group" key={group.label}>
						<div className="docs-nav-grouplabel">{group.label}</div>
						{group.items.map((item) => (
							<div key={item.href} className="docs-nav-branch">
								<Link
									href={item.href}
									className={`docs-nav-item${pathname === item.href ? " active" : ""}`}
								>
									{item.title}
								</Link>
								{pathname === item.href ? outline : null}
							</div>
						))}
					</div>
				))}
			</aside>
		</>
	);
}
