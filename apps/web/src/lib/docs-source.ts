import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pageMarkdown } from "@/app/(www)/docs/api-reference/page-content";
import {
	API_PAGES,
	apiPageHref,
	findApiPage,
} from "@/app/(www)/docs/api-reference/pages";
import { referenceMarkdown } from "@/app/(www)/docs/api-reference/spec";
import {
	mcpResourcesMarkdown,
	mcpToolsMarkdown,
} from "@/app/(www)/docs/mcp/tools";
import { docsNavPages } from "@/app/(www)/docs/nav";
import { sdkPageMarkdown } from "@/app/(www)/docs/sdk-reference/markdown";
import { sdkPages } from "@/app/(www)/docs/sdk-reference/pages";
import { methodNav } from "@/app/(www)/docs/sdk-reference/reference";
import docsPhrasings from "@/generated/docs-phrasings.json";
import apiNav from "@/generated/openapi-nav.json";
import { AGENT_SETUP } from "@/lib/agent-prompts";
import { markdownFence } from "@/lib/code/annotations";
import { docsSearchPool } from "@/lib/command-center/items";
import type { DocsSearchDoc } from "@/lib/docs-bm25";
import { NEW_MARK } from "@/lib/docs-new.mjs";
import GithubSlugger from "github-slugger";

/**
 * Reads the docs' own MDX as plain markdown, so an agent can fetch a page
 * instead of scraping the rendered HTML for it.
 *
 * The MDX files ARE the source of truth — nothing is duplicated into a second
 * agent-facing copy that would drift. What gets stripped is only what a
 * markdown reader can't use: the `export const metadata` block and the JSX
 * component wrappers around otherwise-plain prose.
 */

const DOCS_ROOT = join(process.cwd(), "src", "app", "(www)", "docs");

/** The shared agent setup steps as a markdown section; one source with the prompts. */
const AGENT_SETUP_MD = `## Setup\n\n${AGENT_SETUP}`;

export type DocsPage = { href: string; title: string; group: string };

/** Every page in the sidebar, in sidebar order, sub-pages included. */
export function docsPages(): DocsPage[] {
	return docsNavPages();
}

/** `/docs/subgraphs` → `<docs>/subgraphs/page.mdx`; `/docs` → `<docs>/page.mdx`. */
function sourcePath(href: string): string {
	const rel = href.replace(/^\/docs\/?/, "");
	return rel ? join(DOCS_ROOT, rel, "page.mdx") : join(DOCS_ROOT, "page.mdx");
}

/**
 * A page's `export const agent = \`…\`` block: advice for coding agents, never
 * rendered on the page, appended to its `.md`. The template literal must not
 * contain backticks or `${`; write code as plain words or single quotes.
 */
export function extractAgentNotes(source: string): {
	notes: string | null;
	rest: string;
} {
	const match = /^export const agent\s*=\s*`([\s\S]*?)`;?\s*$/m.exec(source);
	if (!match) return { notes: null, rest: source };
	return {
		notes: match[1].trim(),
		rest: source.replace(match[0], ""),
	};
}

/**
 * MDX → markdown. Deliberately conservative: unwrap the component shells that
 * carry prose, drop the metadata export, and leave every fence, table, and link
 * exactly as authored.
 */
export function mdxToMarkdown(source: string): string {
	return (
		source
			// Callouts stay as comments, `!diff` lines become a unified diff, every
			// other annotation is a rendering hint and goes.
			.replace(
				/^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm,
				(_m, fence: string, info: string, body: string) => {
					const out = markdownFence(info, body.replace(/\n$/, ""));
					return `${fence}${out.info}\n${out.body}\n${fence}`;
				},
			)
			// Prose that points at code (`[text](hover:name)`) or carries a tip
			// (`[text](tip "words")`) reads as its text.
			.replace(/\[([^\]]*)\]\((?:hover|focus):[^)]*\)/g, "$1")
			.replace(/\[([^\]]*)\]\(tip\s+"[^"]*"\)/g, "$1")
			// `export const metadata = {...}` — build-time only, never content.
			.replace(/export const metadata\s*=\s*\{[\s\S]*?\n\};?\n?/g, "")
			.replace(/^export .*$/gm, "")
			.replace(/^import .*$/gm, "")
			// "New" marks only feed the sidebar's chip.
			.replace(new RegExp(NEW_MARK.source, "gm"), "")
			// Native disclosures: markdown readers get a plain heading.
			.replace(/^<details\b[^>]*>\s*$/gm, "")
			.replace(/^<\/details>\s*$/gm, "")
			.replace(/^<summary>(.*)<\/summary>\s*$/gm, "### $1")
			// <Callout type="warning" title="..."> … </Callout> → a quoted aside.
			.replace(
				/<Callout[^>]*title="([^"]*)"[^>]*>/g,
				(_m, title) => `> **${title}**\n>`,
			)
			.replace(/<Callout[^>]*>/g, "> ")
			.replace(/<\/Callout>/g, "")
			// Remaining self-closing or wrapper components carry layout, not text.
			.replace(/<\/?[A-Z][A-Za-z0-9]*(\s[^>]*)?\/?>/g, "")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	);
}

/** One page as markdown, or null when the href isn't a docs page. */
export async function readDocsMarkdown(
	href: string,
	{ setup = true }: { setup?: boolean } = {},
): Promise<string | null> {
	const page = docsPages().find((p) => p.href === href);
	if (!page) return null;
	try {
		let source = await readFile(sourcePath(href), "utf8");
		// The MCP tables are components over the generated registry; swap in
		// their markdown before mdxToMarkdown strips the tags.
		if (href === "/docs/mcp") {
			source = source
				.replace("<McpResources />", mcpResourcesMarkdown())
				.replace("<McpTools />", mcpToolsMarkdown());
		}
		const { notes, rest } = extractAgentNotes(source);
		const markdown = mdxToMarkdown(rest);
		// The reference's body is a component, which mdxToMarkdown strips; its
		// markdown comes from the same spec the page renders.
		const apiPage = findApiPage(href.replace(/^\/docs\/api\//, ""));
		const sdkBody = sdkPageMarkdown(href);
		let out =
			href === "/docs/api-reference"
				? `${markdown}\n\n${referenceMarkdown()}`
				: apiPage && href.startsWith("/docs/api/")
					? `${markdown}\n\n${pageMarkdown(apiPage)}`
					: sdkBody
						? `${markdown}\n\n${sdkBody}`
						: markdown;
		if (notes) out += `\n\n## Notes for agents\n\n${notes}`;
		if (setup) out += `\n\n${AGENT_SETUP_MD}`;
		return out;
	} catch {
		return null;
	}
}

/**
 * Every docs page in one file, sidebar-ordered, each under an `# href` heading
 * so a model can cite the page a passage came from.
 */
export async function readAllDocsMarkdown(): Promise<string> {
	const parts: string[] = [];
	for (const page of docsPages()) {
		const md = await readDocsMarkdown(page.href, { setup: false });
		if (!md) continue;
		parts.push(
			`<!-- source: https://www.secondlayer.tools${page.href} -->\n` +
				`# ${page.group} / ${page.title}\n\n${md}`,
		);
	}
	parts.push(AGENT_SETUP_MD);
	return parts.join("\n\n---\n\n");
}

export type DocsHeading = {
	href: string;
	anchor: string;
	title: string;
	level: 2 | 3 | 4;
};

/** Pages generated from the spec: hundreds of repeated headings, searched by endpoint instead. */
const GENERATED_PAGES = new Set([
	"/docs/api-reference",
	...API_PAGES.map((p) => apiPageHref(p.slug)),
	...sdkPages().map((p) => p.href),
	"/docs/changelog",
]);

const NOT_SEARCHABLE = new Set(["notes for agents", "setup"]);

/** Heading text as the rendered page shows it: no code ticks, links, or emphasis. */
function plainHeading(text: string): string {
	return text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[`*_]/g, "")
		.trim();
}

/**
 * `##`–`####` headings of one page's MDX, with the anchors rehype-slug gives
 * the rendered page (a fresh slugger per page repeats its `-1` suffixes).
 */
export function headingsFromMdx(href: string, source: string): DocsHeading[] {
	const slugger = new GithubSlugger();
	const out: DocsHeading[] = [];
	let fence: string | null = null;
	for (const line of source.split("\n")) {
		const mark = /^\s*(```+|~~~+)/.exec(line)?.[1];
		if (mark) {
			if (!fence) fence = mark[0];
			else if (mark[0] === fence) fence = null;
			continue;
		}
		if (fence) continue;
		const heading = /^(#{2,4})\s+(.+?)\s*#*\s*$/.exec(line);
		if (!heading) continue;
		const title = plainHeading(heading[2]);
		// Slug every heading so duplicate suffixes line up, then drop the ones
		// that are not worth a search row.
		const anchor = slugger.slug(title);
		if (NOT_SEARCHABLE.has(title.toLowerCase())) continue;
		out.push({
			href,
			anchor,
			title,
			level: heading[1].length as DocsHeading["level"],
		});
	}
	return out;
}

/** Every searchable section of every hand-written docs page, sidebar-ordered. */
export async function docsHeadingIndex(): Promise<DocsHeading[]> {
	const pages = docsPages().filter((p) => !GENERATED_PAGES.has(p.href));
	const perPage = await Promise.all(
		pages.map(async (page) => {
			try {
				const source = await readFile(sourcePath(page.href), "utf8");
				return headingsFromMdx(page.href, extractAgentNotes(source).rest);
			} catch {
				return [];
			}
		}),
	);
	return perPage.flat();
}

/** Markdown reduced to prose: no fences, links, markup, or tags. */
export function proseOf(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.split(/(`[^`]*`)/)
		.map((part, i) =>
			// Odd parts are inline code: drop the backticks, keep every character.
			i % 2 ? part.slice(1, -1) : part.replace(/[*_>|#]/g, ""),
		)
		.join("")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** The first two sentences of some markdown, capped for the search index. */
function leadOf(markdown: string): string {
	const prose = proseOf(markdown);
	return (prose.match(/[^.!?]+[.!?]+/g) ?? [prose])
		.slice(0, 2)
		.join(" ")
		.slice(0, 400);
}

/**
 * Every docs search candidate (pages, sections, endpoints) with the text
 * ranked against: title, page, generated phrasings, and a short body. Ids match
 * `docsSearchPool`; the browser fetches this as `/docs/search-index.json`.
 */
export async function docsSearchDocs(): Promise<DocsSearchDoc[]> {
	const sdkNav = methodNav();
	const summaries = new Map(
		sdkNav.flatMap((s) =>
			s.methods.map((m) => [`docs:${s.page}#${m.anchor}`, m.summary]),
		),
	);
	const pool = docsSearchPool(
		await docsHeadingIndex(),
		apiNav,
		docsPhrasings,
		sdkNav,
	);
	const lines = new Map<string, string[]>();
	/** Sections of one page sharing a title are matched in document order. */
	const taken = new Map<string, number>();
	const docs: DocsSearchDoc[] = [];
	for (const item of pool) {
		const href = item.href ?? "";
		const [path, anchor] = href.split("#");
		const kind =
			item.sub === "endpoint"
				? "endpoint"
				: item.sub === "method"
					? "method"
					: anchor
						? "section"
						: "page";
		let body = "";
		if (kind === "method") body = summaries.get(item.id) ?? "";
		else if (kind !== "endpoint") {
			if (!lines.has(path)) {
				lines.set(
					path,
					((await readDocsMarkdown(path, { setup: false })) ?? "").split("\n"),
				);
			}
			const md = lines.get(path) as string[];
			if (kind === "page") {
				const end = md.findIndex((l) => /^##\s/.test(l));
				body = leadOf(
					md
						.filter((l, i) => (end < 0 || i < end) && !/^#\s/.test(l))
						.join("\n"),
				);
			} else {
				const key = `${path}\0${item.label}`;
				const skip = taken.get(key) ?? 0;
				taken.set(key, skip + 1);
				let seen = 0;
				const start = md.findIndex(
					(l) =>
						/^#{2,4}\s/.test(l) &&
						plainHeading(l.replace(/^#+\s*/, "")) === item.label &&
						seen++ === skip,
				);
				if (start >= 0) {
					const rest: string[] = [];
					for (
						let i = start + 1;
						i < md.length && !/^#{1,4}\s/.test(md[i]);
						i++
					)
						rest.push(md[i]);
					body = leadOf(rest.join("\n"));
				}
			}
		}
		docs.push({
			id: item.id,
			href,
			label: item.label,
			sub: item.sub ?? "",
			kind,
			title: item.label,
			page: item.sub ?? "",
			phrasings: (item.keywords ?? []).filter((k) => k !== "docs"),
			body,
		});
	}
	return docs;
}
