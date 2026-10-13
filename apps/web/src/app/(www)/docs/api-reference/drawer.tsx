"use client";

import { FloatingCard } from "@/components/account/floating-card";
import { useRouter } from "next/navigation";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { PromptBlock, SectionActions } from "./client";
import { resolveAnchor } from "./resolve-anchor";

/** Everything the drawer shows for one endpoint or object, rendered on the
 *  server and keyed by anchor. */
export type DrawerDetail = {
	title: string;
	subtitle: ReactNode;
	prompt: string;
	main: ReactNode;
	request: ReactNode;
	response: ReactNode;
};

const VIEW_KEY = "docs-apiref-examples";
/** Full view needs the width for the docs beside a sticky request column. */
const WIDE_QUERY = "(min-width: 1181px)";
/** Breathing room kept under a sticky column taller than the drawer. */
const STICK_BOTTOM = 24;

/**
 * Full view: the docs on the left, the request and response sticky on the
 * right. Remembered per reader (storage is optional); only applies while the
 * screen is wide enough, below that the drawer is one column.
 */
function useFullView(active: boolean) {
	const [on, setOn] = useState(false);
	const [wide, setWide] = useState(false);

	useEffect(() => {
		try {
			setOn(localStorage.getItem(VIEW_KEY) === "split");
		} catch {
			// Blocked storage: single column until toggled.
		}
		const query = window.matchMedia(WIDE_QUERY);
		const apply = () => setWide(query.matches);
		apply();
		query.addEventListener("change", apply);
		return () => query.removeEventListener("change", apply);
	}, []);

	const toggle = useCallback(() => {
		setOn((cur) => {
			try {
				localStorage.setItem(VIEW_KEY, cur ? "single" : "split");
			} catch {
				// Not persisted; the choice still applies to this visit.
			}
			return !cur;
		});
	}, []);

	useEffect(() => {
		if (!active) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "f" && e.key !== "F") return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (!window.matchMedia(WIDE_QUERY).matches) return;
			const t = e.target as HTMLElement | null;
			if (
				t?.isContentEditable ||
				t?.tagName === "INPUT" ||
				t?.tagName === "TEXTAREA" ||
				t?.tagName === "SELECT"
			)
				return;
			e.preventDefault();
			toggle();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, toggle]);

	return { split: on && wide, wide, on, toggle };
}

/**
 * In Full view the request column sticks to the top of the drawer's scroll
 * area. One taller than the area would hide its tail until the end, so it gets
 * a negative `top` and scrolls until its bottom lands, then sticks there.
 */
function useStickyAside(
	root: React.RefObject<HTMLElement | null>,
	enabled: boolean,
	key: string | null,
) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: key re-measures when the content swaps
	useEffect(() => {
		const aside = root.current?.querySelector<HTMLElement>(".apiref-aside");
		const scroller = root.current?.closest<HTMLElement>(".acct-card-body");
		if (!enabled || !aside || !scroller) return;
		const place = () => {
			const top = `${Math.min(0, scroller.clientHeight - aside.offsetHeight - STICK_BOTTOM)}px`;
			if (aside.style.top !== top) aside.style.top = top;
		};
		place();
		const observer = new ResizeObserver(place);
		observer.observe(aside);
		observer.observe(scroller);
		return () => {
			observer.disconnect();
			aside.style.top = "";
		};
	}, [enabled, key, root]);
}

/**
 * The endpoint drawer: the account pages' floating card, filled with the
 * endpoint a row opened. Clicking another row swaps the content in place;
 * the URL's hash follows, so a copied link or a reload reopens it.
 */
export function ApiDrawerHost({
	details,
}: {
	details: Record<string, DrawerDetail>;
}) {
	const router = useRouter();
	const [openId, setOpenId] = useState<string | null>(null);
	const view = useFullView(openId !== null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const detailsRef = useRef(details);
	detailsRef.current = details;

	const open = useCallback((id: string) => {
		setOpenId(id);
		history.replaceState(history.state, "", `#${id}`);
	}, []);

	const close = useCallback(() => {
		setOpenId(null);
		history.replaceState(
			history.state,
			"",
			`${location.pathname}${location.search}`,
		);
	}, []);

	// The hash opens an endpoint on load and on back/forward; one that names
	// something else on the page closes the drawer.
	useEffect(() => {
		const fromHash = () =>
			setOpenId(resolveAnchor(detailsRef.current, location.hash));
		fromHash();
		window.addEventListener("hashchange", fromHash);
		window.addEventListener("popstate", fromHash);
		return () => {
			window.removeEventListener("hashchange", fromHash);
			window.removeEventListener("popstate", fromHash);
		};
	}, []);

	// Rows are plain links in the page; a plain click opens them here.
	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if (e.defaultPrevented || e.button !== 0) return;
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			const row = (e.target as Element).closest<HTMLAnchorElement>(
				"a[data-endpoint-row]",
			);
			const id = row?.getAttribute("href")?.slice(1);
			if (!id || !detailsRef.current[id]) return;
			e.preventDefault();
			open(id);
		};
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, [open]);

	// The open row reads as open: blue path and summary, no background.
	useEffect(() => {
		for (const row of document.querySelectorAll<HTMLElement>(
			"[data-endpoint-row]",
		)) {
			if (row.getAttribute("href") === `#${openId}`) {
				row.setAttribute("data-open", "");
			} else row.removeAttribute("data-open");
		}
		return () => {
			for (const row of document.querySelectorAll("[data-endpoint-row]")) {
				row.removeAttribute("data-open");
			}
		};
	}, [openId]);

	// A new endpoint starts at its top.
	// biome-ignore lint/correctness/useExhaustiveDependencies: openId is the trigger
	useEffect(() => {
		bodyRef.current?.closest(".acct-card-body")?.scrollTo({ top: 0 });
	}, [openId]);

	useStickyAside(bodyRef, view.split, openId);

	// Links inside the drawer: another endpoint of this page replaces the
	// content; one on another API page navigates there with its hash.
	const onDrawerClick = (e: React.MouseEvent) => {
		if (e.defaultPrevented || e.button !== 0) return;
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const link = (e.target as Element).closest<HTMLAnchorElement>("a[href]");
		if (!link) return;
		const url = new URL(link.href, location.href);
		if (url.origin !== location.origin) return;
		if (url.pathname === location.pathname) {
			const id = resolveAnchor(details, url.hash);
			// A field's own link stays: the browser scrolls to and marks it.
			if (!id || url.hash.slice(1) !== id) return;
			e.preventDefault();
			open(id);
		} else if (url.pathname.startsWith("/docs/api/")) {
			e.preventDefault();
			router.push(`${url.pathname}${url.hash}`);
		}
	};

	const detail = openId ? details[openId] : null;
	return (
		<FloatingCard
			open={detail !== null}
			onClose={close}
			title={detail?.title ?? ""}
			subtitle={detail?.subtitle}
			ignoreOutside={(t) => !!t.closest("[data-endpoint-row]")}
			headerActions={
				view.wide ? (
					<button
						type="button"
						className="docs-pill docs-pill-full"
						aria-pressed={view.on}
						aria-keyshortcuts="F"
						title="Full view (F)"
						onClick={view.toggle}
					>
						Full view
					</button>
				) : null
			}
			footer={openId ? <SectionActions anchor={openId} /> : undefined}
		>
			{detail ? (
				// biome-ignore lint/a11y/useKeyWithClickEvents: delegates clicks on the links inside
				<div
					ref={bodyRef}
					className="apiref-drawer"
					data-view={view.split ? "split" : undefined}
					onClick={onDrawerClick}
				>
					<div className="apiref-detail" key={openId}>
						<PromptBlock text={detail.prompt} />
						<div className="apiref-main">{detail.main}</div>
						<aside
							className="apiref-aside"
							aria-label="Example request and response"
						>
							{detail.request}
							{detail.response}
						</aside>
					</div>
				</div>
			) : null}
		</FloatingCard>
	);
}
