import GithubSlugger from "github-slugger";
import { type ApiPage, familiesClaiming, pageForTag } from "./pages";
import {
	type Endpoint,
	type ObjectEntry,
	allEndpoints,
	endpointMarkdown,
	objectMarkdown,
	objectsByTag,
} from "./spec";

/**
 * What the spec puts on each API page. Kept apart from `pages.ts` (the page
 * and family table, which the search palette imports in the browser) because
 * reading the spec pulls in the whole OpenAPI document.
 */

const OTHER = "Other";

export type PageFamily = {
	title: string;
	id: string;
	summary: string;
	endpoints: Endpoint[];
};

export type PageContent = {
	page: ApiPage;
	families: PageFamily[];
	objects: ObjectEntry[];
};

/** Family titles as heading ids, the way rehype-slug makes them. */
export function familyId(title: string): string {
	return new GithubSlugger().slug(title);
}

/** A page's endpoints grouped into its families, in spec order within each. */
export function pageContent(page: ApiPage): PageContent {
	const byFamily = new Map<string, Endpoint[]>();
	for (const endpoint of allEndpoints()) {
		if (!page.tags.includes(endpoint.tag)) continue;
		const title = familiesClaiming(page, endpoint.path)[0]?.title ?? OTHER;
		byFamily.set(title, [...(byFamily.get(title) ?? []), endpoint]);
	}
	const families = [
		...page.families,
		{ title: OTHER, summary: "Endpoints no family claims yet.", paths: [] },
	]
		.map((family) => ({
			title: family.title,
			id: familyId(family.title),
			summary: family.summary,
			endpoints: byFamily.get(family.title) ?? [],
		}))
		.filter((f) => f.endpoints.length > 0);
	const objects = objectsByTag();
	return {
		page,
		families,
		objects: page.tags.flatMap((tag) => objects.get(tag) ?? []),
	};
}

/** A page's families, endpoints and objects as markdown, one level below the
 *  page's own `#` title. The same spec text the drawer renders. */
export function pageMarkdown(page: ApiPage): string {
	const { families, objects } = pageContent(page);
	const demote = (md: string) => md.replace(/^(#{2,3}) /gm, "#$1 ");
	return [
		...families.map((family) =>
			[
				`## ${family.title}`,
				family.summary,
				...family.endpoints.map((e) => demote(endpointMarkdown(e))),
			].join("\n\n"),
		),
		...(objects.length
			? [
					["## Objects", ...objects.map((o) => demote(objectMarkdown(o)))].join(
						"\n\n",
					),
				]
			: []),
	].join("\n\n");
}

/** Every endpoint and object anchor with the page slug that holds it. */
export function anchorPages(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const endpoint of allEndpoints()) {
		const page = pageForTag(endpoint.tag);
		if (page) out[endpoint.anchor] = page.slug;
	}
	for (const [tag, entries] of objectsByTag()) {
		const page = pageForTag(tag);
		if (!page) continue;
		for (const entry of entries) out[entry.anchor] = page.slug;
	}
	return out;
}
