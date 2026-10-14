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
	/** An API family heading, shown as a label over its endpoints. */
	family?: boolean;
	/** An endpoint or object section: the id of the family it nests under. */
	child?: string;
	/** The endpoint's HTTP method, lowercase, for its pill. */
	verb?: string;
}

/** The open page's visible h2s, listed under its row. Reads them from the
 *  rendered article (rehype-slug gives stable ids), skips any inside a
 *  collapsed `<details>`, and marks the topmost one in view as the place being
 *  read. An h3 marked `data-outline-child` (an API endpoint or object) is
 *  listed too, under the family whose id the attribute carries, with its
 *  method pill when it has one.
 *  Other docs pages have no such h3s, so their outline is unchanged. */
function PageOutline({ onNavigate }: { onNavigate: () => void }) {
	const pathname = usePathname();
	const [heads, setHeads] = useState<Head[]>([]);
	const [activeId, setActiveId] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — re-read headings on route change
	useEffect(() => {
		const article = document.getElementById("docs-article");
		const all = Array.from(
			article?.querySelectorAll<HTMLElement>(
				"h2[id], h3[id][data-outline-child]",
			) ?? [],
		)
			.filter((h) => !h.closest("details"))
			.map((h) => ({
				id: h.id,
				text: h.dataset.outline ?? h.textContent ?? "",
				family: h.hasAttribute("data-outline-family"),
				child: h.dataset.outlineChild,
				verb: h.dataset.verb,
			}));
		// The family headings sit together in the page's index, ahead of the
		// sections, so each family's sections are pulled up under it.
		const found = all.flatMap((h) =>
			h.family
				? [h, ...all.filter((c) => c.child === h.id)]
				: h.child
					? []
					: [h],
		);
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
	// An API page lists its endpoints as a tree: an Overview row for the
	// index at the top, family headings as plain labels.
	const tree = heads.some((h) => h.child);
	const atOverview =
		tree && (heads.find((h) => h.id === activeId)?.family ?? true);
	return (
		<div className="docs-nav-outline">
			{tree ? (
				<a
					href={pathname}
					aria-current={atOverview ? "location" : undefined}
					className={`docs-nav-ep${atOverview ? " active" : ""}`}
					onClick={(e) => {
						e.preventDefault();
						window.scrollTo({ top: 0 });
						history.replaceState(history.state, "", pathname);
						onNavigate();
					}}
				>
					Overview
				</a>
			) : null}
			{heads.map((h) =>
				h.family ? (
					<div key={h.id} className="docs-nav-fam">
						{h.text}
					</div>
				) : (
					<a
						key={h.id}
						href={`#${h.id}`}
						aria-current={h.id === activeId ? "location" : undefined}
						className={
							[h.child ? "docs-nav-ep" : "", h.id === activeId ? "active" : ""]
								.filter(Boolean)
								.join(" ") || undefined
						}
						onClick={onNavigate}
					>
						{h.verb ? (
							<span
								className={`apiref-verb apiref-verb-${h.verb} docs-nav-verb`}
							>
								{h.verb === "delete" ? "DEL" : h.verb.toUpperCase()}
							</span>
						) : null}
						{h.child ? (
							<span className="docs-nav-ep-name">{h.text}</span>
						) : (
							h.text
						)}
					</a>
				),
			)}
		</div>
	);
}

function Chevron() {
	return (
		<svg
			className="docs-nav-caret"
			width="12"
			height="12"
			viewBox="0 0 12 12"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden="true"
		>
			<path d="m4.5 3 3 3-3 3" />
		</svg>
	);
}

export function DocsSidebar() {
	const pathname = usePathname();
	const { account, loading, logout } = useAuth();
	const { open, setOpen } = useDocsDrawer();
	// A hash click doesn't change the route, so the phone drawer closes here.
	const outline = <PageOutline onNavigate={() => setOpen(false)} />;
	// The open API page's endpoint tree folds under its row.
	const [folded, setFolded] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — each page opens unfolded
	useEffect(() => {
		setFolded(false);
	}, [pathname]);

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
						{group.items.map((item) => {
							const current = pathname === item.href;
							const tree = item.href.startsWith("/docs/api/");
							return (
								<div key={item.href} className="docs-nav-branch">
									<Link
										href={item.href}
										className={`docs-nav-item${current ? " active" : ""}`}
										aria-expanded={tree ? current && !folded : undefined}
										onClick={
											current && tree
												? (e) => {
														e.preventDefault();
														setFolded(!folded);
													}
												: undefined
										}
									>
										{item.title}
										{tree ? <Chevron /> : null}
									</Link>
									{current && !(tree && folded) ? outline : null}
								</div>
							);
						})}
					</div>
				))}
			</aside>
		</>
	);
}
