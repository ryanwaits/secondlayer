import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { apiPageHref, pageForTag } from "@/app/(www)/docs/api-reference/pages";
import { allEndpoints } from "@/app/(www)/docs/api-reference/spec";
import { type LinkInput, type LinkTable, buildLinkTable } from "./auto-links";

const SRC = join(process.cwd(), "src");
const DOCS = join(SRC, "app", "(www)", "docs");
const REFERENCE = join(SRC, "generated", "reference");

/** Pathnames of the docs pages that exist: a folder holding a `page.mdx` or `page.tsx`, without dynamic segments. */
export function docsRoutes(dir = DOCS, prefix = "/docs"): Set<string> {
	const routes = new Set<string>();
	const entries = readdirSync(dir, { withFileTypes: true });
	if (entries.some((e) => e.isFile() && /^page\.(mdx|tsx)$/.test(e.name)))
		routes.add(prefix);
	for (const e of entries) {
		if (!e.isDirectory() || e.name.startsWith("[")) continue;
		for (const route of docsRoutes(join(dir, e.name), `${prefix}/${e.name}`))
			routes.add(route);
	}
	return routes;
}

/**
 * Every `symbols` map under `generated/reference/*`, merged. Two packages can
 * each declare a type of the same name (`FtTransferPayload`); the SDK's page
 * wins, then the rest in name order, so a name never changes home by accident.
 */
export function referenceSymbols(dir = REFERENCE): Record<string, string> {
	const packages = readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort(
			(a, b) => Number(b === "sdk") - Number(a === "sdk") || (a < b ? -1 : 1),
		);
	const symbols: Record<string, string> = {};
	for (const name of packages) {
		const index = JSON.parse(
			readFileSync(join(dir, name, "manifest.json"), "utf8"),
		) as { symbols?: Record<string, string> };
		for (const [symbol, href] of Object.entries(index.symbols ?? {}))
			symbols[symbol] ??= href;
	}
	return symbols;
}

function endpointLinks(): LinkInput["endpoints"] {
	return allEndpoints().flatMap((e) => {
		const page = pageForTag(e.tag);
		return page
			? [{ path: e.path, href: `${apiPageHref(page.slug)}#${e.anchor}` }]
			: [];
	});
}

/** What the build knows before pages are checked: reference symbols, endpoints, routes. */
export function linkInput(): LinkInput {
	return {
		symbols: referenceSymbols(),
		endpoints: endpointLinks(),
		routes: docsRoutes(),
	};
}

let table: LinkTable | undefined;

/** The links this build knows, read once per process. */
export function linkTable(): LinkTable {
	table ??= buildLinkTable(linkInput());
	return table;
}
