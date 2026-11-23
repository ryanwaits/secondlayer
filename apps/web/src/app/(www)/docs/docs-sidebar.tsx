"use client";

import docsNewPages from "@/generated/docs-new.json";
import { clearAccountData } from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import { isFresh } from "@/lib/docs-new.mjs";
import { DOCS_STRIP } from "@/lib/nav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { useDocsDrawer } from "./docs-drawer";
import { DOCS_NAV } from "./nav";
import { activeHeading, isAtScrollEnd } from "./outline-spy";

const REVEAL_MARGIN = 8;

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
	family?: boolean;
	child?: string;
	group?: string;
}

function PageOutline({ onNavigate }: { onNavigate: () => void }) {
	const pathname = usePathname();
	const [heads, setHeads] = useState<Head[]>([]);
	const [activeId, setActiveId] = useState("");
	const held = useRef("");

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
			}));
		const found = all.flatMap((h) =>
			h.family
				? [h, ...all.filter((c) => c.child === h.id)]
				: h.child
					? []
					: [h],
		);
		const seam = article?.querySelector("[data-outline-reference]");
		const first = seam
			? found.find((h) => {
					const el = h.family || h.child ? null : document.getElementById(h.id);
					return (
						el &&
						seam.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
					);
				})
			: undefined;
		setHeads(
			found.map((h) => (h === first ? { ...h, group: "Reference" } : h)),
		);
		held.current = "";
		setActiveId(found[0]?.id ?? "");
	}, [pathname]);

	// Scrollspy: the active heading is the last one whose top has reached the
	// spy line, or the last heading at the scroll end. The line sits where an
	// anchor jump lands a heading (scroll padding plus the heading's own scroll
	// margin), so a jumped-to section is active on arrival. A clicked row stays
	// active (held) until the reader scrolls by hand.
	useEffect(() => {
		if (heads.length === 0) return;
		const spyLine = () => {
			const first = document.getElementById(heads[0].id);
			return (
				Number.parseFloat(
					getComputedStyle(document.documentElement).scrollPaddingTop,
				) +
				(first
					? Number.parseFloat(getComputedStyle(first).scrollMarginTop)
					: 0) +
				8
			);
		};
		let line = spyLine();
		let frame = 0;
		const read = () => {
			frame = 0;
			if (held.current) return;
			const tops = heads.map(
				(h) => document.getElementById(h.id)?.getBoundingClientRect().top ?? 0,
			);
			const at = activeHeading(
				tops,
				line,
				isAtScrollEnd(
					window.scrollY,
					window.innerHeight,
					document.documentElement.scrollHeight,
				),
			);
			if (at >= 0) setActiveId(heads[at].id);
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(read);
		};
		const onResize = () => {
			line = spyLine();
			onScroll();
		};
		const release = () => {
			held.current = "";
		};
		const onKey = (e: KeyboardEvent) => {
			if (
				[
					"ArrowDown",
					"ArrowUp",
					"PageDown",
					"PageUp",
					"Home",
					"End",
					" ",
				].includes(e.key)
			)
				release();
		};
		const onPointer = (e: PointerEvent) => {
			if (!(e.target as Element | null)?.closest(".docs-nav")) release();
		};
		read();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onResize);
		window.addEventListener("wheel", release, { passive: true });
		window.addEventListener("touchstart", release, { passive: true });
		window.addEventListener("keydown", onKey);
		window.addEventListener("pointerdown", onPointer, { passive: true });
		return () => {
			if (frame) cancelAnimationFrame(frame);
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onResize);
			window.removeEventListener("wheel", release);
			window.removeEventListener("touchstart", release);
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("pointerdown", onPointer);
		};
	}, [heads]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: activeId is the trigger — the active link is read from the DOM
	useEffect(() => {
		const nav = document.querySelector<HTMLElement>(".docs-nav");
		const link = nav?.querySelector<HTMLElement>(".docs-nav-outline a.active");
		if (nav && link) revealNearest(nav, link);
	}, [activeId]);

	if (heads.length === 0) return null;
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
					<Fragment key={h.id}>
						{h.group ? (
							<div className="docs-nav-outline-label">{h.group}</div>
						) : null}
						<a
							href={`#${h.id}`}
							aria-current={h.id === activeId ? "location" : undefined}
							className={
								[
									h.child ? "docs-nav-ep" : "",
									h.id === activeId ? "active" : "",
								]
									.filter(Boolean)
									.join(" ") || undefined
							}
							onClick={() => {
								held.current = h.id;
								setActiveId(h.id);
								onNavigate();
							}}
						>
							{h.child ? (
								<span className="docs-nav-ep-name">{h.text}</span>
							) : (
								h.text
							)}
						</a>
					</Fragment>
				),
			)}
		</div>
	);
}

function NewChip() {
	return <span className="docs-nav-new">New</span>;
}

const NEW_PAGES: Record<string, string> = docsNewPages;

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
	// Read after mount: the server's clock must not decide a chip the client
	// then disagrees with.
	const [now, setNow] = useState(0);
	useEffect(() => setNow(Date.now()), []);
	// A hash click doesn't change the route, so the phone drawer closes here.
	const outline = <PageOutline onNavigate={() => setOpen(false)} />;
	const [folded, setFolded] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — each page opens unfolded
	useEffect(() => {
		setFolded(false);
	}, [pathname]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — reveal the active row per page
	useEffect(() => {
		const nav = document.querySelector<HTMLElement>(".docs-nav");
		const row = nav?.querySelector<HTMLElement>(
			":scope > .docs-nav-group .docs-nav-branch > .docs-nav-item.active",
		);
		if (!nav || !row) return;
		revealNearest(nav, row);
	}, [pathname]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — close the drawer on navigation
	useEffect(() => {
		setOpen(false);
	}, [pathname, setOpen]);

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
				<div className="docs-nav-group docs-nav-products">
					<div className="docs-nav-grouplabel">Site</div>
					<div className="docs-nav-products-grid">
						{DOCS_STRIP.map((p) => (
							<Link key={p.href} href={p.href} className="docs-nav-item">
								{p.label}
							</Link>
						))}
						{!loading && !account ? (
							<Link href="/signin" className="docs-nav-item">
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
										{isFresh(NEW_PAGES[item.href], now) ? <NewChip /> : null}
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
