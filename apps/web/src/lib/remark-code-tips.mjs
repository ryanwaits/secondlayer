/**
 * Remark plugin: which names a guide's code blocks may tip. A guide explains a
 * name where it first appears, so the page keeps a ledger: SDK methods and
 * endpoint paths only (types belong to the reference), each name once per
 * page, at most two per `##` section. The names ride on the fence as
 * `data-tips` (space separated) for `MdxPre`, and `<Code>` tips exactly those.
 *
 * Only guides: reference, API and changelog pages, the docs hub and everything
 * outside `/docs` are left alone, and a tab group tips its first fence only
 * (its twins show the same call in another language). Hand-walks the mdast
 * like remark-code-meta, and is registered by absolute path in next.config.ts
 * because Turbopack cannot serialize functions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanLine } from "./code/tip-scan.mjs";

/** At most this many automatic tips under one `##`. */
export const PER_SECTION = 2;

const NOT_GUIDES = new Set(["api", "api-reference", "changelog"]);
const ANNOTATION_LINE = /^\s*(?:\/\/|#)\s*!\w+/;
const KINDS = new Set(["method", "endpoint"]);

/** `.../app/(www)/docs/streams/page.mdx` is `/docs/streams`; anything not a page under the app is null. */
export function routeOf(path) {
	const match = /[\\/]app[\\/]\(www\)(.*)[\\/]page\.mdx$/.exec(path ?? "");
	return match ? (match[1] ?? "").replace(/\\/g, "/") || "/" : null;
}

/** A hand-written guide: `/docs/<name>…` that is not the hub, the changelog, an API page or a reference. */
export function isGuide(route) {
	if (!route?.startsWith("/docs/")) return false;
	const first = route.split("/")[2] ?? "";
	return !NOT_GUIDES.has(first) && !first.endsWith("-reference");
}

let table;
const tipTable = () => {
	table ??= JSON.parse(
		readFileSync(join(process.cwd(), "src", "generated", "tips.json"), "utf8"),
	);
	return table;
};

/** The names to tip, in order, from one fence's source. */
function namesIn(node, table) {
	const out = [];
	for (const line of String(node.value ?? "").split("\n")) {
		if (ANNOTATION_LINE.test(line)) continue;
		for (const hit of scanLine(line, node.lang ?? "", table))
			if (KINDS.has(hit.kind)) out.push(hit.name);
	}
	return out;
}

export default function remarkCodeTips() {
	return (tree, file) => {
		if (!isGuide(routeOf(file?.path))) return;
		const table = tipTable();
		const seen = new Set();
		let inSection = 0;

		const tip = (node) => {
			const awarded = [];
			for (const name of namesIn(node, table)) {
				// The first mention is the one that counts, tipped or not.
				if (seen.has(name)) continue;
				seen.add(name);
				if (inSection < PER_SECTION) {
					inSection++;
					awarded.push(name);
				}
			}
			if (!awarded.length) return;
			node.data = node.data ?? {};
			node.data.hProperties = {
				...node.data.hProperties,
				"data-tips": awarded.join(" "),
			};
		};

		const firstFence = (node) => {
			if (node.type === "code") return node;
			for (const child of node.children ?? []) {
				const found = firstFence(child);
				if (found) return found;
			}
			return null;
		};

		const walk = (node) => {
			if (node.type === "heading" && node.depth === 2) inSection = 0;
			if (node.type === "code") return tip(node);
			if (node.name === "CodeTabs") {
				const first = firstFence(node);
				if (first) tip(first);
				return;
			}
			for (const child of node.children ?? []) walk(child);
		};
		walk(tree);
	};
}
