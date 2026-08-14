"use client";

import { MobileNavCta } from "@/components/mobile-nav-cta";
import {
	NAV,
	type NavGroup,
	type NavSubgraph,
	activeGroupIndex,
	activeHref,
	isGroup,
} from "@/lib/nav";
import { appHostname, marketingUrl } from "@/lib/urls";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** Hover-intent windows. Opening is deliberate; closing forgives a diagonal. */
const OPEN_DELAY = 100;
const CLOSE_GRACE = 180;

function Brand({ href = "/" }: { href?: string }) {
	return (
		<Link href={href} className="marketing-nav-brand">
			<svg
				viewBox="4 7 40 28"
				width="22"
				height="15"
				fill="none"
				aria-hidden="true"
			>
				<polygon points="8,25 28,17 42,25 22,33" className="logo-echo" />
				<polygon points="8,19 28,11 42,19 22,27" className="logo-primary" />
			</svg>
			<span>secondlayer</span>
		</Link>
	);
}

function Chevron() {
	return (
		<svg className="mnav-chev" viewBox="0 0 8 5" aria-hidden="true">
			<path
				d="M1 1l3 3 3-3"
				stroke="currentColor"
				strokeWidth="1.3"
				fill="none"
				strokeLinecap="round"
			/>
		</svg>
	);
}

/**
 * Top-left product nav for marketing pages — the counterpart to AuthBar
 * (top-right), sharing its mono-uppercase link treatment so the two read
 * as one bar. Docs and platform keep their own chrome: this renders null
 * there (docs has the sidebar shell; platform is outside the (www) group).
 *
 * Five top-level entries; four of them open a panel on hover. Below 800px the
 * links give way to a hamburger that opens a full-screen sheet where the same
 * groups become accordions, closed except the one holding the current route.
 */
export function MarketingNav({
	liveSubgraphs = [],
}: { liveSubgraphs?: NavSubgraph[] }) {
	const pathname = usePathname();

	const [sheetOpen, setSheetOpen] = useState(false);
	/** Index of the open desktop panel, or null. One at a time. */
	const [openPanel, setOpenPanel] = useState<number | null>(null);
	/** Which sheet accordions are expanded, keyed by group index. */
	const [expanded, setExpanded] = useState<Record<number, boolean>>({});

	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const navRef = useRef<HTMLElement | null>(null);
	/** Set on navigation, released by the next real pointer movement. */
	const hoverLocked = useRef(false);
	const firstRender = useRef(true);

	// Product/marketing pages live on the marketing host. When this nav renders
	// on the app host (e.g. the /login page), relative links would resolve to
	// app.* and get bounced by middleware, so cross them to the marketing host.
	// Resolved post-mount to keep SSR + marketing-host output relative (no
	// hydration mismatch, client-side nav preserved on the marketing site).
	const [onAppHost, setOnAppHost] = useState(false);
	useEffect(() => {
		const host = appHostname();
		setOnAppHost(host !== null && window.location.host === host);
	}, []);
	const navHref = (href: string) => (onAppHost ? marketingUrl(href) : href);

	const active = activeHref(pathname);
	const activeGroup = activeGroupIndex(pathname);

	const clear = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	}, []);

	// The sheet opens with the current section already expanded, so it always
	// reflects where you are rather than starting uniformly closed.
	useEffect(() => {
		setExpanded(activeGroup >= 0 ? { [activeGroup]: true } : {});
	}, [activeGroup]);

	// Close everything whenever the route changes (i.e. a link is tapped), then
	// ignore hover until the pointer actually moves. Clicking a panel item
	// leaves the cursor parked inside the group it just navigated from, and the
	// browser re-fires enter/over as the page swaps under it — without this the
	// panel pops straight back open on the page you just landed on. /docs was
	// the one place it looked fine, only because this nav unmounts there.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger — close on navigation
	useEffect(() => {
		// Nothing is open on first mount, and locking hover there would mean a
		// cursor already resting on a trigger at load has to jiggle to work.
		if (firstRender.current) {
			firstRender.current = false;
			return;
		}
		setSheetOpen(false);
		setOpenPanel(null);
		clear();
		hoverLocked.current = true;
		const release = () => {
			hoverLocked.current = false;
		};
		window.addEventListener("pointermove", release, { once: true });
		return () => window.removeEventListener("pointermove", release);
	}, [pathname, clear]);

	// Escape closes the sheet; lock body scroll while it's open.
	useEffect(() => {
		if (!sheetOpen) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setSheetOpen(false);
		}
		document.addEventListener("keydown", onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prev;
		};
	}, [sheetOpen]);

	// A click anywhere outside the bar dismisses an open panel.
	useEffect(() => {
		if (openPanel === null) return;
		function onClick(e: MouseEvent) {
			if (!navRef.current?.contains(e.target as Node)) setOpenPanel(null);
		}
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, [openPanel]);

	const enter = useCallback(
		(i: number) => {
			if (hoverLocked.current) return;
			clear();
			// A panel is already showing, so the user is scanning the bar — swap
			// immediately rather than making them wait out the intent delay again.
			if (openPanel !== null && openPanel !== i) {
				setOpenPanel(i);
				return;
			}
			timer.current = setTimeout(() => setOpenPanel(i), OPEN_DELAY);
		},
		[clear, openPanel],
	);

	const leave = useCallback(() => {
		clear();
		timer.current = setTimeout(() => setOpenPanel(null), CLOSE_GRACE);
	}, [clear]);

	/** Dismiss immediately on click, rather than waiting for the route to change. */
	const dismiss = useCallback(() => {
		clear();
		setOpenPanel(null);
	}, [clear]);

	useEffect(() => clear, [clear]);

	function onPanelKeyDown(e: React.KeyboardEvent<HTMLSpanElement>, i: number) {
		if (e.key === "Escape") {
			setOpenPanel(null);
			(e.currentTarget.querySelector(".mnav-trigger") as HTMLElement)?.focus();
			return;
		}
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		e.preventDefault();
		setOpenPanel(i);
		const items = Array.from(
			e.currentTarget.querySelectorAll<HTMLElement>(".mnav-item"),
		);
		if (!items.length) return;
		const at = items.indexOf(document.activeElement as HTMLElement);
		const next =
			e.key === "ArrowDown"
				? (at + 1) % items.length
				: at <= 0
					? items.length - 1
					: at - 1;
		items[next]?.focus();
	}

	if (pathname.startsWith("/docs")) return null;

	function Panel({ group }: { group: NavGroup }) {
		const showLive = group.live && liveSubgraphs.length > 0;
		return (
			<div className="mnav-panel" role="menu">
				<div className="mnav-panel-caption">{group.caption}</div>
				{group.items.map((item) => (
					<Link
						key={item.href}
						href={navHref(item.href)}
						className="mnav-item"
						role="menuitem"
						aria-current={active === item.href ? "page" : undefined}
						onClick={dismiss}
					>
						<span className="t">{item.label}</span>
						<span className="d">{item.desc}</span>
					</Link>
				))}
				{showLive && (
					<>
						<div className="mnav-rule" />
						<div className="mnav-live-head">
							<span>
								<span className="mnav-dot" />
								Live now
							</span>
							<span>rows</span>
						</div>
						{liveSubgraphs.map((sg) => (
							<Link
								key={sg.name}
								href={navHref(`/subgraphs/explore/${sg.name}`)}
								className="mnav-item mnav-live"
								role="menuitem"
								onClick={dismiss}
							>
								<span className="s">{sg.name}</span>
								<span className="n">{sg.rows}</span>
							</Link>
						))}
					</>
				)}
				{group.foot && <div className="mnav-panel-foot">{group.foot}</div>}
			</div>
		);
	}

	return (
		<>
			<nav className="marketing-nav" aria-label="Site" ref={navRef}>
				<Brand href={navHref("/")} />

				{NAV.map((entry, i) => {
					if (!isGroup(entry)) {
						return (
							<Link
								key={entry.href}
								href={navHref(entry.href)}
								className="auth-bar-nav-link marketing-nav-link"
								aria-current={active === entry.href ? "page" : undefined}
							>
								<span className="auth-bar-nav-label">{entry.label}</span>
							</Link>
						);
					}

					const open = openPanel === i;
					const current = activeGroup === i;
					const shared = {
						className: "auth-bar-nav-link marketing-nav-link mnav-trigger",
						"aria-expanded": open,
						"aria-haspopup": true as const,
						"aria-current": current ? ("page" as const) : undefined,
					};

					return (
						<span
							key={entry.label}
							className="mnav-group"
							data-open={open}
							onMouseEnter={() => enter(i)}
							onMouseLeave={leave}
							onKeyDown={(e) => onPanelKeyDown(e, i)}
							onBlur={(e) => {
								if (!e.currentTarget.contains(e.relatedTarget as Node)) {
									setOpenPanel((c) => (c === i ? null : c));
								}
							}}
						>
							{/* Docs is a link and a trigger at once: click navigates, hover opens. */}
							{entry.href ? (
								<Link href={navHref(entry.href)} {...shared} onClick={dismiss}>
									<span className="auth-bar-nav-label">{entry.label}</span>
									<Chevron />
								</Link>
							) : (
								<button
									type="button"
									{...shared}
									onClick={() => setOpenPanel(open ? null : i)}
								>
									<span className="auth-bar-nav-label">{entry.label}</span>
									<Chevron />
								</button>
							)}
							<Panel group={entry} />
						</span>
					);
				})}

				<span className="marketing-nav-spacer" aria-hidden="true" />
				<MobileNavCta className="auth-bar-cta mnav-bar-cta" />
				<button
					type="button"
					className="mnav-burger"
					aria-label="Open navigation"
					aria-expanded={sheetOpen}
					onClick={() => setSheetOpen(true)}
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
			</nav>

			{sheetOpen && (
				<div className="mnav-sheet">
					<div className="mnav-sheet-bar">
						<Brand href={navHref("/")} />
						<button
							type="button"
							className="mnav-close"
							onClick={() => setSheetOpen(false)}
						>
							Close ✕
						</button>
					</div>

					<nav className="mnav-list" aria-label="Products">
						{NAV.map((entry, i) => {
							const no = String(i + 1).padStart(2, "0");

							if (!isGroup(entry)) {
								return (
									<Link
										key={entry.href}
										href={navHref(entry.href)}
										className={`mnav-flat${active === entry.href ? " active" : ""}`}
									>
										<span className="no">{no}</span>
										<span className="nm">{entry.label}</span>
									</Link>
								);
							}

							const open = expanded[i] ?? false;
							return (
								<div key={entry.label} className="mnav-acc" data-open={open}>
									<button
										type="button"
										className="mnav-acc-top"
										aria-expanded={open}
										onClick={() =>
											setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))
										}
									>
										<span className="no">{no}</span>
										<span className="nm">{entry.label}</span>
										<span className="sp" />
										<span className="ct">{entry.items.length}</span>
										<svg
											className="mnav-acc-chev"
											viewBox="0 0 10 6"
											aria-hidden="true"
										>
											<path
												d="M1 1l4 4 4-4"
												stroke="currentColor"
												strokeWidth="1.4"
												fill="none"
												strokeLinecap="round"
											/>
										</svg>
									</button>
									<div className="mnav-acc-body">
										<div className="mnav-acc-inner">
											{entry.items.map((item) => (
												<Link
													key={item.href}
													href={navHref(item.href)}
													className={`mnav-acc-row${active === item.href ? " active" : ""}`}
												>
													{item.label}
												</Link>
											))}
										</div>
									</div>
								</div>
							);
						})}
					</nav>

					<div className="mnav-foot">
						<Link href={navHref("/docs/self-host")} className="mnav-cta">
							Self-host
						</Link>
						<Link href={navHref("/docs")} className="mnav-login">
							Docs
						</Link>
					</div>
				</div>
			)}
		</>
	);
}
