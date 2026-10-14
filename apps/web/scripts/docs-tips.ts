/**
 * Writes the tip table (src/generated/tips.json): one short summary per SDK
 * method, exported type and API endpoint, the text a code block's tooltip and
 * popover show. A name without a summary, or whose reference page does not
 * exist, has no entry, so it gets no tip. Entries never carry a link: `route`
 * and `anchor` only let a tip light its row when the reader is already on that
 * reference page.
 *
 * Usage (from apps/web): bun run docs:tips
 */

import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	apiPageHref,
	pageForTag,
} from "../src/app/(www)/docs/api-reference/pages";
import { allEndpoints } from "../src/app/(www)/docs/api-reference/spec";
import {
	SDK_BASE,
	SDK_SURFACES,
	findPackagePage,
} from "../src/app/(www)/docs/sdk-reference/pages";
import {
	type Method,
	type ReferencePackage,
	type Surface,
	constructorEntry,
	manifest,
	methodAnchor,
	surface,
} from "../src/app/(www)/docs/sdk-reference/reference";
import type { Tip, TipTable } from "../src/lib/code/tip-table";

const WEB = join(import.meta.dir, "..");
const DOCS = join(WEB, "src", "app", "(www)", "docs");
const OUT = join(WEB, "src", "generated", "tips.json");

export const MAX_SUMMARY = 160;
const MAX_FIELDS = 8;
/** A type longer than this is shown as an ellipsis: the popover is a glance, the reference has the rest. */
const MAX_TYPE = 40;

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

/** Plain text: links keep their label, inline code loses its ticks, whitespace collapses. */
function plain(text: string): string {
	return text
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/`/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * A summary that fits a tooltip. A longer one is cut at its first clause break
 * (a dash, semicolon or colon); one with no break to cut at has no tip until
 * its reference summary is shortened.
 */
export function clip(summary: string): string {
	if (summary.length <= MAX_SUMMARY) return summary;
	const head = summary.slice(0, MAX_SUMMARY);
	const cut = /\s[—–]\s|[;:]\s/.exec(head);
	if (!cut || cut.index < 20) return "";
	return `${summary.slice(0, cut.index).replace(/[,.;:\s]+$/, "")}.`;
}

/** The first sentence of a description, as plain text. */
export function firstSentence(text: string): string {
	const flat = plain(text);
	const end = /[.!?](?=\s|$)/.exec(flat);
	return clip(end ? flat.slice(0, end.index + 1) : flat);
}

const compact = (type: string, max = MAX_TYPE) => {
	const flat = type.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : "…";
};

function methodSig(method: Method): string | undefined {
	const overload = method.overloads[0];
	if (!overload) return undefined;
	const params = overload.params.map(
		(p) => `${p.name}${p.required ? "" : "?"}: ${compact(p.type)}`,
	);
	const returns = overload.returns.type
		? `: ${compact(overload.returns.type, 60)}`
		: "";
	return `${method.path}(${params.join(", ")})${returns}`;
}

const pathOf = (href: string) => href.split("#")[0] ?? "";
const anchorOf = (href: string) => href.split("#")[1] ?? "";

/** The packages whose reference pages exist: the SDK first, the function-first ones in name order. */
function packages(): ReferencePackage[] {
	const names = readdirSync(join(WEB, "src", "generated", "reference"), {
		withFileTypes: true,
	})
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort(
			(a, b) => Number(b === "sdk") - Number(a === "sdk") || (a < b ? -1 : 1),
		);
	return names as ReferencePackage[];
}

/** A package's surfaces with the page each renders on: one per SDK surface, one page for a function-first package. */
function surfacesOf(
	pkg: ReferencePackage,
): { route: string; surface: Surface }[] {
	const slugs = new Set(manifest(pkg).surfaces.map((s) => s.slug));
	if (pkg === "sdk") for (const s of SDK_SURFACES) slugs.add(s.slug);
	return [...slugs].flatMap((slug) => {
		try {
			return [
				{
					route:
						pkg === "sdk" ? `${SDK_BASE}/${slug}` : findPackagePage(pkg).href,
					surface: surface(slug, pkg),
				},
			];
		} catch {
			return [];
		}
	});
}

export function buildTips(): TipTable {
	const routes = docsRoutes();
	const symbols: Record<string, Tip> = {};
	for (const pkg of packages()) {
		// Anchors repeat across an SDK package's pages (`m-events-consume` is on
		// Streams and on Index), so entries are found by page and anchor.
		const methods = new Map<string, Method>();
		const types = new Map<string, Surface["types"][number]>();
		for (const { route, surface: s } of surfacesOf(pkg)) {
			const ctor = constructorEntry(s);
			if (ctor) methods.set(`${route}#${methodAnchor(ctor.id)}`, ctor);
			for (const m of s.methods)
				methods.set(`${route}#${methodAnchor(m.id)}`, m);
			for (const t of s.types) {
				const key = `${route}#t-${t.name}`;
				if (!types.has(key)) types.set(key, t);
			}
		}
		for (const [name, href] of Object.entries(manifest(pkg).symbols)) {
			const route = pathOf(href);
			const anchor = anchorOf(href);
			if (symbols[name] || !routes.has(route)) continue;
			if (anchor.startsWith("m-")) {
				const method = methods.get(href);
				const summary = clip(plain(method?.summary ?? ""));
				if (!method || !summary) continue;
				symbols[name] = {
					kind: "method",
					summary,
					sig: methodSig(method),
					route,
					anchor,
				};
			} else if (anchor.startsWith("t-")) {
				const type = types.get(href);
				const summary = clip(plain(type?.summary ?? ""));
				if (!type || !summary) continue;
				const fields = type.fields ?? [];
				symbols[name] = {
					kind: "type",
					summary,
					...(fields.length
						? {
								fields: fields
									.slice(0, MAX_FIELDS)
									.map((f) => ({ name: f.name, type: compact(f.type) })),
							}
						: {}),
					...(fields.length > MAX_FIELDS
						? { more: fields.length - MAX_FIELDS }
						: {}),
					route,
					anchor,
				};
			}
		}
	}
	const seen = new Set<string>();
	const endpoints: TipTable["endpoints"] = [];
	for (const e of allEndpoints()) {
		const page = pageForTag(e.tag);
		if (!page || seen.has(e.path)) continue;
		const route = apiPageHref(page.slug);
		const summary = firstSentence(e.op.description ?? "");
		if (!summary || !routes.has(route)) continue;
		seen.add(e.path);
		endpoints.push({
			path: e.path,
			method: e.method,
			tip: { kind: "endpoint", summary, route, anchor: e.anchor },
		});
	}
	return { symbols, endpoints };
}

export const serialize = (table: TipTable) =>
	`${JSON.stringify(table, null, "\t")}\n`;

if (import.meta.main) {
	const table = buildTips();
	writeFileSync(OUT, serialize(table));
	console.log(
		`wrote ${Object.keys(table.symbols).length} symbols, ${table.endpoints.length} endpoints`,
	);
}
