"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Frame, openFrame } from "./peek/frame";
import { loadTarget, prefetch } from "./peek/load";
import {
	type BackSlot,
	type PeekKind,
	type SavedItem,
	TRAIL_EVENT,
	addSaved,
	isSaved,
	labelAtTop,
	labelFor,
	leavesScreen,
	listSaved,
	onScreen,
	peekBack,
	removeSaved,
	setBack,
	setPendingRestore,
	takeBack,
} from "./trail-store";

const JUMP_LINKS = '#docs-article a[data-link="jump"]';
const PEEK_LINKS = '#docs-article a[data-link="peek"]';
const FIELD = 'input, textarea, select, [contenteditable="true"]';

/** The frame that is open: one at a time. */
type Peek = {
	/** Tells a late fetch whether its frame is still the open one. */
	id: number;
	link: HTMLAnchorElement;
	href: string;
	kind: PeekKind;
	frame: Frame;
	/** Empty until the target has loaded. */
	title: string;
	pageTitle: string;
};

/** Every guide link in the article, in order; the slot remembers an index into this. */
const guideLinks = () =>
	document.querySelectorAll<HTMLAnchorElement>("#docs-article a[data-link]");

/** The article's direct child that holds `el`: where a frame goes, under the whole block. */
function topBlock(el: Element): Element {
	const article = el.closest("#docs-article");
	let block = el;
	while (block.parentElement && block.parentElement !== article)
		block = block.parentElement;
	return block;
}

/**
 * Light the sentence you came from: the link in the reference color and its
 * row in `soft` (DESIGN.md: lit references). The mark stays until the next
 * click anywhere. Returns what undoes it.
 */
function markLink(linkIndex: number): () => void {
	const link = guideLinks()[linkIndex];
	if (!link) return () => {};
	const block = link.closest("p, li, tr") ?? topBlock(link);
	link.classList.add("docs-lit");
	block.classList.add("docs-lit-row");
	link.focus({ preventScroll: true });

	const clear = () => {
		link.classList.remove("docs-lit");
		block.classList.remove("docs-lit-row");
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

/** The bar itself: Back and Saved, or nothing when it has neither. */
export function TrailBar({
	slot,
	saved = [],
	listOpen = false,
	onBack,
	onToggleSaved = () => {},
	onOpenSaved = () => {},
	onRemoveSaved = () => {},
}: {
	slot: BackSlot | null;
	saved?: SavedItem[];
	listOpen?: boolean;
	onBack: () => void;
	onToggleSaved?: () => void;
	onOpenSaved?: (item: SavedItem) => void;
	onRemoveSaved?: (href: string) => void;
}) {
	if (!slot && !saved.length) return null;
	return (
		<section className="docs-trail" aria-label="Your place">
			{slot ? (
				<button type="button" className="docs-trail-back" onClick={onBack}>
					<span aria-hidden="true">←</span>
					<span className="docs-trail-label">
						Back to <b>{slot.label}</b>
					</span>
				</button>
			) : null}
			{slot && saved.length ? (
				<span className="docs-trail-sep" aria-hidden="true" />
			) : null}
			{saved.length ? (
				<button
					type="button"
					className="docs-trail-saved"
					aria-expanded={listOpen}
					onClick={onToggleSaved}
				>
					Saved <b>{saved.length}</b>
				</button>
			) : null}
			{listOpen && saved.length ? (
				<ul className="docs-trail-list" aria-label="Saved sections">
					{/* Newest first. */}
					{[...saved].reverse().map((item) => (
						<li key={item.href} className="docs-trail-row">
							<button
								type="button"
								className="docs-trail-open"
								onClick={() => onOpenSaved(item)}
							>
								<span className="docs-trail-title">{item.title}</span>
								{item.title !== item.pageTitle ? (
									<span className="docs-trail-sub">{item.pageTitle}</span>
								) : null}
								<span className="docs-trail-from">from {item.from.label}</span>
							</button>
							<button
								type="button"
								className="docs-trail-remove"
								aria-label={`Remove ${item.title}`}
								onClick={() => onRemoveSaved(item.href)}
							>
								×
							</button>
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}

/**
 * The trail holds your place in the docs. A link in a guide that scrolls its
 * own sentence off screen leaves a Back at the bottom of the reading column;
 * it only watches those clicks, so FastAnchorScroll still does the scrolling
 * and the jump's landing is predicted rather than waited for. A link to another
 * docs page opens what it points at in a frame under its block (a peek), whose
 * bar saves it for later or opens the page with a Back to the sentence.
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
	const [saved, setSaved] = useState<SavedItem[]>([]);
	const [listOpen, setListOpen] = useState(false);
	// The key handler outlives renders, so it reads the list's state from here.
	const listOpenRef = useRef(false);
	listOpenRef.current = listOpen;
	const peek = useRef<Peek | null>(null);
	const peekSerial = useRef(0);

	useEffect(() => {
		const sync = () => {
			setSlot(peekBack());
			setSaved(listSaved());
		};
		sync();
		window.addEventListener(TRAIL_EVENT, sync);
		// Saved is shared by every tab.
		window.addEventListener("storage", sync);
		return () => {
			window.removeEventListener(TRAIL_EVENT, sync);
			window.removeEventListener("storage", sync);
		};
	}, []);

	// Nothing left to list.
	useEffect(() => {
		if (!saved.length) setListOpen(false);
	}, [saved]);

	// Esc and an outside click close the Saved list.
	useEffect(() => {
		if (!listOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!(e.target as Element | null)?.closest?.(".docs-trail"))
				setListOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [listOpen]);

	const closePeek = useCallback((refocus: boolean) => {
		const open = peek.current;
		if (!open) return;
		peek.current = null;
		open.frame.close();
		open.link.removeAttribute("aria-expanded");
		if (refocus) open.link.focus({ preventScroll: true });
	}, []);

	// A frame belongs to the page it was opened on.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger
	useEffect(() => () => closePeek(false), [pathname, closePeek]);

	useEffect(() => {
		/** Where a link sits now: the Back a frame's Open or a link inside it leaves. */
		const spotOf = (link: HTMLAnchorElement): BackSlot => ({
			path: location.pathname,
			scrollY: window.scrollY,
			linkIndex: [...guideLinks()].indexOf(link),
			label: labelFor(link),
		});

		const openPeek = (link: HTMLAnchorElement) => {
			const href = link.getAttribute("href") ?? "";
			const kind = (link.dataset.peekKind ?? "section") as PeekKind;
			const open: Peek = {
				id: ++peekSerial.current,
				link,
				href,
				kind,
				frame: openFrame(topBlock(link), { kind, saved: isSaved(href) }),
				title: "",
				pageTitle: "",
			};
			peek.current = open;
			link.setAttribute("aria-expanded", "true");
			open.frame.focusSave();
			// A cold page fills in when it arrives; one that cannot be had
			// still gets the reader there.
			loadTarget(href, kind).then((found) => {
				if (peek.current?.id !== open.id) return;
				if (!found) {
					closePeek(false);
					router.push(href);
					return;
				}
				open.title = found.title;
				open.pageTitle = found.pageTitle;
				open.frame.fill(found);
			});
		};

		/** What a frame's buttons and keys do. */
		const act = (action: string | undefined) => {
			const open = peek.current;
			if (!open) return;
			if (action === "close") closePeek(true);
			else if (action === "more") {
				open.frame.expand();
				// The button that had focus is gone; keep the keys working.
				open.frame.focusSave();
			} else if (action === "save" && open.title) {
				addSaved({
					href: open.href,
					title: open.title,
					pageTitle: open.pageTitle,
					kind: open.kind,
					from: { path: location.pathname, label: labelFor(open.link) },
				});
				open.frame.markSaved(true);
			} else if (action === "open") {
				setBack(spotOf(open.link));
				closePeek(false);
				// The new page starts at its target, not where this one was.
				router.push(open.href);
			}
		};

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
			const hit = e.target as Element | null;

			const control = hit?.closest?.<HTMLElement>(".docs-peek [data-peek]");
			if (control) {
				e.preventDefault();
				act(control.dataset.peek);
				return;
			}

			// A link inside a frame leaves the page it is on: keep the sentence
			// the frame was opened from as the way Back. Next's Link is not on
			// these cloned anchors, so the navigation is ours.
			const inside = hit?.closest?.<HTMLAnchorElement>(".docs-peek a[href]");
			if (inside) {
				const open = peek.current;
				const url = new URL(inside.href, location.href);
				if (
					!open ||
					url.origin !== location.origin ||
					!url.pathname.startsWith("/docs") ||
					inside.target === "_blank"
				)
					return;
				e.preventDefault();
				setBack(spotOf(open.link));
				closePeek(false);
				router.push(url.pathname + url.search + url.hash);
				return;
			}

			// Decided now, before any fetch: a click cannot wait for its page.
			const peekLink = hit?.closest?.<HTMLAnchorElement>(PEEK_LINKS);
			if (peekLink) {
				e.preventDefault();
				const open = peek.current;
				closePeek(false);
				// Another click on the open link closes it.
				if (open?.link !== peekLink) openPeek(peekLink);
				return;
			}

			const link = hit?.closest?.<HTMLAnchorElement>(JUMP_LINKS);
			// A link to the hash already in the URL goes nowhere: Next's Link
			// handles it first and leaves the page where it is.
			if (!link || link.hash === location.hash) return;
			const anchor = document.getElementById(
				decodeURIComponent(new URL(link.href).hash.slice(1)),
			);
			if (!anchor) return;
			const { scrollY, innerHeight } = window;
			const linkBox = link.getBoundingClientRect();
			const paddingTop =
				Number.parseFloat(
					getComputedStyle(document.documentElement).scrollPaddingTop,
				) || 0;
			const leaves = leavesScreen({
				linkTop: linkBox.top + scrollY,
				linkBottom: linkBox.bottom + scrollY,
				targetTop: anchor.getBoundingClientRect().top + scrollY,
				paddingTop,
				viewportHeight: innerHeight,
				maxScroll: document.documentElement.scrollHeight - innerHeight,
			});
			if (!leaves) return;
			sawLinkLeave.current = false;
			setBack(spotOf(link));
		};

		// Esc closes the Saved list first, then the frame; S and O act on the
		// frame while focus is inside it.
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key === "Escape" && listOpenRef.current) {
				setListOpen(false);
				return;
			}
			const open = peek.current;
			if (!open) return;
			const focus = document.activeElement;
			const inFrame = !!focus && open.frame.el.contains(focus);
			if (e.key === "Escape") {
				// Not while a field has it: Esc there belongs to the field.
				if (!(e.target as Element | null)?.closest?.(FIELD)) closePeek(true);
			} else if (inFrame && !e.shiftKey) {
				const key = e.key.toLowerCase();
				if (key === "s") act("save");
				else if (key === "o") act("open");
			}
		};

		// A hovered or focused link warms the page, so the click finds it.
		const warm = (e: Event) => {
			const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>(
				PEEK_LINKS,
			);
			if (link) prefetch(link.href);
		};

		document.addEventListener("click", onClick, true);
		document.addEventListener("keydown", onKey);
		document.addEventListener("pointerover", warm);
		document.addEventListener("focusin", warm);
		return () => {
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("pointerover", warm);
			document.removeEventListener("focusin", warm);
		};
	}, [closePeek, router]);

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

	// A Saved row opens its page, and the place you left it for is the way Back.
	const openSaved = (item: SavedItem) => {
		setBack({
			path: location.pathname,
			scrollY: window.scrollY,
			linkIndex: -1,
			label: labelAtTop(),
		});
		closePeek(false);
		setListOpen(false);
		router.push(item.href);
	};

	return (
		<div className="docs-trail-dock" aria-live="polite">
			<TrailBar
				slot={slot}
				saved={saved}
				listOpen={listOpen}
				onBack={goBack}
				onToggleSaved={() => setListOpen((open) => !open)}
				onOpenSaved={openSaved}
				onRemoveSaved={removeSaved}
			/>
		</div>
	);
}
