/**
 * The docs trail's memory. The Back slot is the one place a reader can go
 * back to: a guide link that scrolls its own sentence off screen leaves a slot
 * (the page, the scroll offset, which link, the heading it sat under), and the
 * bar reads it. One slot, the newest wins, and it lives in `sessionStorage` so
 * it survives a navigation but not the tab. Saved is the list of sections a
 * reader kept from a peek, in `localStorage` so it outlives the tab. Storage
 * can be missing or throw (private windows, blocked site data), so every
 * access is a silent no-op on failure.
 */

export type BackSlot = {
	path: string;
	scrollY: number;
	linkIndex: number;
	label: string;
};

export type PeekKind = "section" | "page" | "api";

export type SavedItem = {
	href: string;
	title: string;
	pageTitle: string;
	kind: PeekKind;
	from: { path: string; label: string };
	savedAt: number;
};

const BACK_KEY = "sl.docs.back";
const RESTORE_KEY = "sl.docs.restore";
const SAVED_KEY = "sl.docs.saved";
const SAVED_CAP = 50;
export const TRAIL_EVENT = "docs-trail";
const BAR_HEIGHT = 56;

const area = (persistent: boolean) =>
	persistent ? localStorage : sessionStorage;

function read(key: string, persistent = false): string | null {
	try {
		return area(persistent).getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string | null, persistent = false) {
	try {
		if (value === null) area(persistent).removeItem(key);
		else area(persistent).setItem(key, value);
	} catch {}
}

function announce() {
	try {
		window.dispatchEvent(new CustomEvent(TRAIL_EVENT));
	} catch {}
}

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

export function setBack(slot: BackSlot) {
	write(BACK_KEY, JSON.stringify(slot));
	announce();
}

export function takeBack(): BackSlot | null {
	const slot = peekBack();
	write(BACK_KEY, null);
	announce();
	return slot;
}

export function setPendingRestore(scrollY: number) {
	write(RESTORE_KEY, String(scrollY));
}

export function takePendingRestore(): number | null {
	const raw = read(RESTORE_KEY);
	write(RESTORE_KEY, null);
	if (raw === null) return null;
	const scrollY = Number(raw);
	return Number.isFinite(scrollY) ? scrollY : null;
}

export function onScreen(
	top: number,
	bottom: number,
	viewportHeight: number,
): boolean {
	return bottom > 0 && top < viewportHeight - BAR_HEIGHT;
}

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

export function labelFor(link: Element): string {
	const article = link.closest("#docs-article");
	let label = "";
	for (const heading of article?.querySelectorAll("h2, h3, h4") ?? []) {
		if (heading.closest(".docs-peek")) continue;
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

export function headingAbove(
	headings: { top: number; text: string }[],
	line: number,
): string | null {
	let found: string | null = null;
	for (const heading of headings) {
		if (heading.top > line) break;
		found = heading.text.trim() || found;
	}
	return found;
}

export function labelAtTop(): string {
	const article = document.getElementById("docs-article");
	const paddingTop =
		Number.parseFloat(
			getComputedStyle(document.documentElement).scrollPaddingTop,
		) || 0;
	const headings = [...(article?.querySelectorAll("h2, h3, h4") ?? [])]
		.filter((heading) => !heading.closest(".docs-peek"))
		.map((heading) => ({
			top: heading.getBoundingClientRect().top,
			text: heading.textContent ?? "",
		}));
	return (
		headingAbove(headings, paddingTop + 1) ||
		article?.querySelector(".page-title")?.textContent?.trim() ||
		"previous place"
	);
}

const KINDS: readonly string[] = ["section", "page", "api"];

function isSavedItem(value: unknown): value is SavedItem {
	const item = value as Partial<SavedItem> | null;
	return (
		!!item &&
		typeof item.href === "string" &&
		item.href.startsWith("/docs") &&
		typeof item.title === "string" &&
		typeof item.pageTitle === "string" &&
		typeof item.kind === "string" &&
		KINDS.includes(item.kind) &&
		typeof item.savedAt === "number" &&
		typeof item.from?.path === "string" &&
		typeof item.from?.label === "string"
	);
}

export function listSaved(): SavedItem[] {
	const raw = read(SAVED_KEY, true);
	if (!raw) return [];
	try {
		const items = JSON.parse(raw);
		return Array.isArray(items) ? items.filter(isSavedItem) : [];
	} catch {
		return [];
	}
}

export const isSaved = (href: string) =>
	listSaved().some((item) => item.href === href);

export function addSaved(item: Omit<SavedItem, "savedAt">, now = Date.now()) {
	const kept = listSaved().filter((saved) => saved.href !== item.href);
	kept.push({ ...item, savedAt: now });
	write(SAVED_KEY, JSON.stringify(kept.slice(-SAVED_CAP)), true);
	announce();
}

export function removeSaved(href: string) {
	write(
		SAVED_KEY,
		JSON.stringify(listSaved().filter((item) => item.href !== href)),
		true,
	);
	announce();
}
