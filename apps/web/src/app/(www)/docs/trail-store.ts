/**
 * The docs trail's memory: the one place a reader can go Back to. A guide link
 * that scrolls its own sentence off screen leaves a slot (the page, the scroll
 * offset, which link, the heading it sat under); the bar reads it. One slot,
 * the newest wins, and it lives in `sessionStorage` so it survives a
 * navigation but not the tab. Storage can be missing or throw (private
 * windows, blocked site data), so every access is a silent no-op on failure.
 */

export type BackSlot = {
	path: string;
	scrollY: number;
	/** The link's index among `#docs-article a[data-link]`; the pages are static, so it is stable. */
	linkIndex: number;
	/** The nearest heading before the link, else the page title. */
	label: string;
};

const BACK_KEY = "sl.docs.back";
const RESTORE_KEY = "sl.docs.restore";
/** Fired on `window` whenever the slot changes, so the bar can follow. */
export const TRAIL_EVENT = "docs-trail";
/** The bar's height; a link under it is as good as off screen. */
const BAR_HEIGHT = 56;

function read(key: string): string | null {
	try {
		return sessionStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string | null) {
	try {
		if (value === null) sessionStorage.removeItem(key);
		else sessionStorage.setItem(key, value);
	} catch {}
}

function announce() {
	try {
		window.dispatchEvent(new CustomEvent(TRAIL_EVENT));
	} catch {}
}

/** The slot, or null when empty or not one of ours. */
export function peekBack(): BackSlot | null {
	const raw = read(BACK_KEY);
	if (!raw) return null;
	try {
		const slot = JSON.parse(raw) as Partial<BackSlot>;
		if (
			typeof slot.path === "string" &&
			slot.path.startsWith("/docs") &&
			typeof slot.scrollY === "number" &&
			typeof slot.linkIndex === "number" &&
			typeof slot.label === "string"
		)
			return slot as BackSlot;
	} catch {}
	return null;
}

/** Replace the slot. */
export function setBack(slot: BackSlot) {
	write(BACK_KEY, JSON.stringify(slot));
	announce();
}

/** Read the slot and clear it. */
export function takeBack(): BackSlot | null {
	const slot = peekBack();
	write(BACK_KEY, null);
	announce();
	return slot;
}

/** A scroll offset to land on after the next docs navigation (read by DocsScrollTop). */
export function setPendingRestore(scrollY: number) {
	write(RESTORE_KEY, String(scrollY));
}

/** The pending offset, once. */
export function takePendingRestore(): number | null {
	const raw = read(RESTORE_KEY);
	write(RESTORE_KEY, null);
	if (raw === null) return null;
	const scrollY = Number(raw);
	return Number.isFinite(scrollY) ? scrollY : null;
}

/** Whether any part of an element at viewport `top`..`bottom` is readable above the bar. */
export function onScreen(
	top: number,
	bottom: number,
	viewportHeight: number,
): boolean {
	return bottom > 0 && top < viewportHeight - BAR_HEIGHT;
}

/**
 * Will the jump to a link's target scroll the link out of sight? Coordinates
 * are document coordinates. The jump lands the target at `paddingTop`
 * (clamped to the page's scroll range), so the link's place after it is known
 * without waiting for the glide to end.
 */
export function leavesScreen({
	linkTop,
	linkBottom,
	targetTop,
	paddingTop,
	viewportHeight,
	maxScroll = Number.POSITIVE_INFINITY,
}: {
	linkTop: number;
	linkBottom: number;
	targetTop: number;
	paddingTop: number;
	viewportHeight: number;
	maxScroll?: number;
}): boolean {
	const landing = Math.min(Math.max(targetTop - paddingTop, 0), maxScroll);
	return !onScreen(linkTop - landing, linkBottom - landing, viewportHeight);
}

/** The text of the nearest heading before `link` in its article, else the page title. */
export function labelFor(link: Element): string {
	const article = link.closest("#docs-article");
	let label = "";
	for (const heading of article?.querySelectorAll("h2, h3, h4") ?? []) {
		if (
			!(
				heading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING
			)
		)
			break;
		label = heading.textContent ?? "";
	}
	return (
		label.trim() ||
		article?.querySelector(".page-title")?.textContent?.trim() ||
		"previous place"
	);
}
