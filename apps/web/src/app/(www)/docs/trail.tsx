"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
	type BackSlot,
	TRAIL_EVENT,
	labelFor,
	leavesScreen,
	onScreen,
	peekBack,
	setBack,
	setPendingRestore,
	takeBack,
} from "./trail-store";

const JUMP_LINKS = '#docs-article a[data-link="jump"]';

/** Every guide link in the article, in order; the slot remembers an index into this. */
const guideLinks = () =>
	document.querySelectorAll<HTMLAnchorElement>("#docs-article a[data-link]");

/**
 * Light the sentence you came from: the link in the reference color and its
 * row in `soft` (DESIGN.md: lit references). The mark stays until the next
 * click anywhere. Returns what undoes it.
 */
function markLink(linkIndex: number): () => void {
	const link = guideLinks()[linkIndex];
	if (!link) return () => {};
	const article = link.closest("#docs-article");
	let block: Element | null = link.closest("p, li, tr");
	if (!block) {
		block = link;
		while (block.parentElement && block.parentElement !== article)
			block = block.parentElement;
	}
	link.classList.add("docs-lit");
	block.classList.add("docs-lit-row");
	link.focus({ preventScroll: true });

	const clear = () => {
		link.classList.remove("docs-lit");
		block?.classList.remove("docs-lit-row");
		document.removeEventListener("pointerdown", clear);
	};
	// Not this click's own pointerdown, which has already happened.
	const arm = setTimeout(
		() => document.addEventListener("pointerdown", clear, { once: true }),
		0,
	);
	return () => {
		clearTimeout(arm);
		clear();
	};
}

/** The bar itself: renders nothing without a slot. */
export function TrailBar({
	slot,
	onBack,
}: { slot: BackSlot | null; onBack: () => void }) {
	if (!slot) return null;
	return (
		<section className="docs-trail" aria-label="Your place">
			<button type="button" className="docs-trail-back" onClick={onBack}>
				<span aria-hidden="true">←</span>
				<span className="docs-trail-label">
					Back to <b>{slot.label}</b>
				</span>
			</button>
		</section>
	);
}

/**
 * A link in a guide that scrolls its own sentence off screen leaves a Back at
 * the bottom of the reading column. It only watches: the click is never
 * stopped, so FastAnchorScroll still does the scrolling, and the jump's
 * landing is predicted rather than waited for.
 */
export function DocsTrail() {
	const pathname = usePathname();
	const router = useRouter();
	const [slot, setSlot] = useState<BackSlot | null>(null);
	const unmark = useRef<(() => void) | null>(null);
	// A Back from another page marks its link once that page has mounted.
	const markAfterNav = useRef<{ path: string; linkIndex: number } | null>(null);
	// The jump's own scrolling starts with the link in view; only a link seen
	// leaving counts as one the reader can return to by hand.
	const sawLinkLeave = useRef(false);

	useEffect(() => {
		const sync = () => setSlot(peekBack());
		sync();
		window.addEventListener(TRAIL_EVENT, sync);
		return () => window.removeEventListener(TRAIL_EVENT, sync);
	}, []);

	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if (
				e.defaultPrevented ||
				e.button !== 0 ||
				e.metaKey ||
				e.ctrlKey ||
				e.shiftKey ||
				e.altKey
			)
				return;
			const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>(
				JUMP_LINKS,
			);
			// A link to the hash already in the URL goes nowhere: Next's Link
			// handles it first and leaves the page where it is.
			if (!link || link.hash === location.hash) return;
			const target = document.getElementById(
				decodeURIComponent(new URL(link.href).hash.slice(1)),
			);
			if (!target) return;
			const { scrollY, innerHeight } = window;
			const linkBox = link.getBoundingClientRect();
			const paddingTop =
				Number.parseFloat(
					getComputedStyle(document.documentElement).scrollPaddingTop,
				) || 0;
			const leaves = leavesScreen({
				linkTop: linkBox.top + scrollY,
				linkBottom: linkBox.bottom + scrollY,
				targetTop: target.getBoundingClientRect().top + scrollY,
				paddingTop,
				viewportHeight: innerHeight,
				maxScroll: document.documentElement.scrollHeight - innerHeight,
			});
			if (!leaves) return;
			sawLinkLeave.current = false;
			setBack({
				path: location.pathname,
				scrollY,
				linkIndex: [...guideLinks()].indexOf(link),
				label: labelFor(link),
			});
		};
		document.addEventListener("click", onClick, true);
		return () => document.removeEventListener("click", onClick, true);
	}, []);

	// The reader scrolled back to the link themselves: the bar has done its job.
	useEffect(() => {
		if (!slot || slot.path !== pathname) return;
		let frame = 0;
		const check = () => {
			frame = 0;
			// A scroll queued before a navigation must not read the next page's links.
			if (location.pathname !== slot.path) return;
			const link = guideLinks()[slot.linkIndex];
			if (!link) return;
			const box = link.getBoundingClientRect();
			if (!onScreen(box.top, box.bottom, window.innerHeight)) {
				sawLinkLeave.current = true;
			} else if (sawLinkLeave.current) {
				sawLinkLeave.current = false;
				takeBack();
			}
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(check);
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			window.removeEventListener("scroll", onScroll);
			cancelAnimationFrame(frame);
		};
	}, [slot, pathname]);

	useEffect(() => {
		const pending = markAfterNav.current;
		if (pending?.path !== pathname) return;
		markAfterNav.current = null;
		unmark.current?.();
		unmark.current = markLink(pending.linkIndex);
	}, [pathname]);

	useEffect(() => () => unmark.current?.(), []);

	const goBack = () => {
		const taken = takeBack();
		if (!taken) return;
		if (taken.path === pathname) {
			window.scrollTo({ top: taken.scrollY, behavior: "instant" });
			unmark.current?.();
			unmark.current = markLink(taken.linkIndex);
			return;
		}
		markAfterNav.current = { path: taken.path, linkIndex: taken.linkIndex };
		setPendingRestore(taken.scrollY);
		router.push(taken.path);
	};

	return (
		<div className="docs-trail-dock" aria-live="polite">
			<TrailBar slot={slot} onBack={goBack} />
		</div>
	);
}
