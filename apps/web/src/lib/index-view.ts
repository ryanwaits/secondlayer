export const INDEX_VIEW_COOKIE = "sl_index_view";
const MAX_AGE_S = 365 * 24 * 60 * 60;

export type IndexView = "rows" | "ribbon";
export type IndexPage = "webhooks" | "subgraphs";
export type IndexViews = Partial<Record<IndexPage, IndexView>>;

const PAGES: readonly IndexPage[] = ["webhooks", "subgraphs"];
const isView = (v: string): v is IndexView => v === "rows" || v === "ribbon";

export function serializeIndexViews(views: IndexViews): string {
	return encodeURIComponent(
		PAGES.flatMap((page) => {
			const view = views[page];
			return view ? [`${page}:${view}`] : [];
		}).join("~"),
	);
}

export function parseIndexViews(raw: string | null | undefined): IndexViews {
	if (!raw) return {};
	let text = raw;
	try {
		text = decodeURIComponent(raw);
	} catch {}
	const out: IndexViews = {};
	for (const part of text.split("~")) {
		const [page, view] = part.split(":");
		if (PAGES.includes(page as IndexPage) && view && isView(view)) {
			out[page as IndexPage] = view;
		}
	}
	return out;
}

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

export function writeIndexViews(views: IndexViews): void {
	try {
		const secure = window.location.protocol === "https:" ? "; Secure" : "";
		document.cookie = `${INDEX_VIEW_COOKIE}=${serializeIndexViews(views)}; path=/account; max-age=${MAX_AGE_S}; SameSite=Lax${secure}`;
	} catch {}
}
