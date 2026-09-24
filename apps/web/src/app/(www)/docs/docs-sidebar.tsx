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

/** A jump's hold ends once the page has sat still for this many frames. */
const STILL_FRAMES = 6;
/** How many times a settled jump that missed its section is re-landed. */
const MAX_CORRECTIONS = 3;

/**
 * The section of the reference being read: the last one whose top has passed
 * the line where a jump to its anchor lands (the page's scroll-padding plus
 * the section's scroll-margin, so a clicked section is always the one read).
 * Recomputed per frame on scroll and mirrored into the URL hash. A clicked
 * link is active at once and holds through its smooth scroll (until the page
 * stops moving, or the reader scrolls themselves), so the sections it passes
 * neither flash in the sidebar nor rewrite the URL. Stillness is watched per
 * frame rather than via `scrollend`, which Safari lacks and some Chromes fire
 * mid-animation.
 */
function useActiveSection(enabled: boolean): string {
	const [active, setActive] = useState("");
	useEffect(() => {
		if (!enabled) return;
		let frame = 0;
		let watch = 0;
		let target = "";
		// The sections and the line don't change while scrolling; read them
		// once (the line again on resize, where the mobile scroll-padding
		// applies), not per frame.
		const sections = [
			...document.querySelectorAll<HTMLElement>(".apiref-section"),
		];
		const measureLine = () => {
			const padding = Number.parseFloat(
				getComputedStyle(document.documentElement).scrollPaddingTop,
			);
			const margin = sections[0]
				? Number.parseFloat(getComputedStyle(sections[0]).scrollMarginTop)
				: 0;
			return (padding || 0) + (margin || 0) + 8;
		};
		let line = measureLine();
		const onResize = () => {
			line = measureLine();
		};
		const compute = () => {
			frame = 0;
			if (target) return;
			let current = "";
			for (const section of sections) {
				if (section.getBoundingClientRect().top > line) break;
				current = section.id;
			}
			// At the page's end, a short last section never reaches the line;
			// the one the URL names wins while it's on screen.
			const atEnd =
				window.innerHeight + window.scrollY >=
				document.documentElement.scrollHeight - 2;
			const named = document.getElementById(
				decodeURIComponent(location.hash.slice(1)),
			);
			if (atEnd && named?.classList.contains("apiref-section")) {
				const top = named.getBoundingClientRect().top;
				if (top >= 0 && top < window.innerHeight) current = named.id;
			}
			setActive(current);
			// Keep the URL on the section being read, so a copied or reloaded
			// link lands there. replaceState adds no history entries.
			if (current && location.hash !== `#${current}`) {
				history.replaceState(history.state, "", `#${current}`);
			}
		};
		const release = () => {
			cancelAnimationFrame(watch);
			if (!target) return;
			target = "";
			compute();
		};
		const onScroll = () => {
			if (target) return;
			if (!frame) frame = requestAnimationFrame(compute);
		};
		const hold = (id: string) => {
			const section = document.getElementById(id);
			if (!section?.classList.contains("apiref-section")) return;
			setActive(id);
			target = id;
			let lastY = window.scrollY;
			let still = 0;
			let corrections = 0;
			cancelAnimationFrame(watch);
			const tick = () => {
				still = window.scrollY === lastY ? still + 1 : 0;
				lastY = window.scrollY;
				if (still < STILL_FRAMES) {
					watch = requestAnimationFrame(tick);
					return;
				}
				// A jump aimed before the page finished laying out (a fresh
				// load's native hash scroll) can settle off target; land it.
				const top = section.getBoundingClientRect().top;
				if ((top < 0 || top > line) && corrections < MAX_CORRECTIONS) {
					corrections++;
					still = 0;
					section.scrollIntoView({ behavior: "instant", block: "start" });
					watch = requestAnimationFrame(tick);
					return;
				}
				release();
			};
			watch = requestAnimationFrame(tick);
		};
		const onHash = () => hold(decodeURIComponent(location.hash.slice(1)));
		// The smooth scroll starts on click, a frame or two before hashchange;
		// holding from the click keeps that first frame from counting.
		const onClick = (event: MouseEvent) => {
			const link = (event.target as Element | null)?.closest?.("a");
			const href = link?.getAttribute("href");
			if (href?.startsWith("#")) hold(decodeURIComponent(href.slice(1)));
		};
		// Arriving on a section's link: land on it at once and hold it, rather
		// than let the smooth scroll's passing sections rewrite the URL.
		const arrived = document.getElementById(
			decodeURIComponent(location.hash.slice(1)),
		);
		if (arrived?.classList.contains("apiref-section")) {
			hold(arrived.id);
			arrived.scrollIntoView({ behavior: "instant", block: "start" });
		} else {
			compute();
		}
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onResize);
		window.addEventListener("hashchange", onHash);
		document.addEventListener("click", onClick, true);
		// The reader taking over ends a jump's hold at once.
		for (const type of ["wheel", "touchstart", "keydown"]) {
			window.addEventListener(type, release, { passive: true });
		}
		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onResize);
			window.removeEventListener("hashchange", onHash);
			document.removeEventListener("click", onClick, true);
			for (const type of ["wheel", "touchstart", "keydown"]) {
				window.removeEventListener(type, release);
			}
			cancelAnimationFrame(frame);
			cancelAnimationFrame(watch);
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

/** The reference's tree, shown under its nav item while it's open: each tag's
 *  objects, then its endpoints, in page order. Tags and rows reuse the
 *  sidebar's own item and rail classes. */
function ApiReferenceNav({ active }: { active: string }) {
	return (
		<div className="docs-nav-children">
			{apiNav.map((group) => {
				const rows = [...group.objects, ...group.endpoints];
				const open = rows.some((row) => row.anchor === active);
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
							{rows.map((row) => (
								<a
									key={row.anchor}
									href={`#${row.anchor}`}
									className={`docs-nav-item docs-nav-child${row.anchor === active ? " active" : ""}`}
								>
									{row.title}
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
