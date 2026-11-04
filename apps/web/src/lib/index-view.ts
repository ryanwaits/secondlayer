/**
 * Which view each index page shows, Rows or Ribbon. Kept in a small
 * first-party cookie so the server render already shows the right one.
 */

export const INDEX_VIEW_COOKIE = "sl_index_view";
const MAX_AGE_S = 365 * 24 * 60 * 60;

export type IndexView = "rows" | "ribbon";
export type IndexPage = "webhooks" | "subgraphs";
export type IndexViews = Partial<Record<IndexPage, IndexView>>;

const PAGES: readonly IndexPage[] = ["webhooks", "subgraphs"];
const isView = (v: string): v is IndexView => v === "rows" || v === "ribbon";

/** `webhooks:ribbon~subgraphs:rows`, URL-encoded. */
export function serializeIndexViews(views: IndexViews): string {
	return encodeURIComponent(
		PAGES.flatMap((page) => {
			const view = views[page];
			return view ? [`${page}:${view}`] : [];
		}).join("~"),
	);
}

/** The saved views; anything malformed is dropped, so the default applies. */
export function parseIndexViews(raw: string | null | undefined): IndexViews {
	if (!raw) return {};
	let text = raw;
	try {
		text = decodeURIComponent(raw);
	} catch {
		// Already decoded, or not ours: parse it as it is.
	}
	const out: IndexViews = {};
	for (const part of text.split("~")) {
		const [page, view] = part.split(":");
		if (PAGES.includes(page as IndexPage) && view && isView(view)) {
			out[page as IndexPage] = view;
		}
	}
	return out;
}

/** The cookie as the browser holds it now, so a write keeps the other page's choice. */
export function readIndexViews(): IndexViews {
	try {
		const entry = document.cookie
			.split("; ")
			.find((c) => c.startsWith(`${INDEX_VIEW_COOKIE}=`));
		return parseIndexViews(entry?.slice(INDEX_VIEW_COOKIE.length + 1));
	} catch {
		return {};
	}
}

/** Writes the cookie from the browser. A blocked cookie means the choice
 *  lasts for this visit only. */
export function writeIndexViews(views: IndexViews): void {
	try {
		const secure = window.location.protocol === "https:" ? "; Secure" : "";
		document.cookie = `${INDEX_VIEW_COOKIE}=${serializeIndexViews(views)}; path=/account; max-age=${MAX_AGE_S}; SameSite=Lax${secure}`;
	} catch {
		// Cookies are blocked.
	}
}
