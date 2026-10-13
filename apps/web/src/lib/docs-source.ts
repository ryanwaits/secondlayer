import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { referenceMarkdown } from "@/app/(www)/docs/api-reference/spec";
import {
	mcpResourcesMarkdown,
	mcpToolsMarkdown,
} from "@/app/(www)/docs/mcp/tools";
import { docsNavPages } from "@/app/(www)/docs/nav";
import docsPhrasings from "@/generated/docs-phrasings.json";
import apiNav from "@/generated/openapi-nav.json";
import { AGENT_SETUP } from "@/lib/agent-prompts";
import { docsSearchPool } from "@/lib/command-center/items";
import type { DocsSearchDoc } from "@/lib/docs-bm25";
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
			// `export const metadata = {...}` — build-time only, never content.
			.replace(/export const metadata\s*=\s*\{[\s\S]*?\n\};?\n?/g, "")
			.replace(/^export .*$/gm, "")
			.replace(/^import .*$/gm, "")
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
		let out =
			href === "/docs/api-reference"
				? `${markdown}\n\n${referenceMarkdown()}`
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
			`<!-- source: https://secondlayer.tools${page.href} -->\n` +
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
	level: 2 | 3;
};

/** Pages generated from the spec: hundreds of repeated headings, searched by endpoint instead. */
const GENERATED_PAGES = new Set([
	"/docs/api-reference",
	"/docs/sdk-reference",
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

const SUMMARY_MAX = 160;

/** Prose as plain text: no links, code ticks, emphasis, or inline tags. */
function plainProse(text: string): string {
	return text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/[`*_]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** First sentence of a paragraph, capped at 160 chars on a word boundary. */
function firstSentence(paragraph: string): string {
	const text = plainProse(paragraph);
	const end = /[.!?](?=\s|$)/.exec(text);
	const sentence = end ? text.slice(0, end.index + 1) : text;
	if (sentence.length <= SUMMARY_MAX) return sentence;
	const cut = sentence.slice(0, SUMMARY_MAX - 1);
	return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}

/** A line that continues a prose paragraph, not markup, a list, or data. */
function isProse(line: string): boolean {
	return !/^\s*(<|\||>|\{|\}|import |export |[-*]\s|\d+\.\s|#)/.test(line);
}

export type DocsSection = DocsHeading & { summary: string };

/**
 * One page's searchable sections plus its lede (first sentence under the H1).
 * Sections are `##`/`###` headings and `<details id>` rows, with the anchors
 * the rendered page carries: rehype-slug's for headings (a fresh slugger per
 * page repeats its `-1` suffixes), the authored id for rows. A summary is the
 * first prose sentence of the section (fences, tables, and lists skipped).
 */
export function sectionsFromMdx(
	href: string,
	source: string,
): { lede: string; sections: DocsSection[] } {
	const slugger = new GithubSlugger();
	const sections: DocsSection[] = [];
	const ledeSlot = { summary: "" };
	let seenH1 = false;
	let fence: string | null = null;
	let rowId: string | null = null;
	let target = null as { summary: string } | null;
	let para: string[] = [];
	const flush = () => {
		if (target && !target.summary && para.length)
			target.summary = firstSentence(para.join(" "));
		para = [];
	};
	const retarget = (next: { summary: string } | null) => {
		flush();
		target = next;
	};
	const body = source.replace(
		/^export const metadata\s*=\s*\{[\s\S]*?\n\};?[ \t]*$/m,
		"",
	);
	for (const line of body.split("\n")) {
		const mark = /^\s*(```+|~~~+)/.exec(line)?.[1];
		if (mark) {
			if (!fence) {
				flush();
				fence = mark[0];
			} else if (mark[0] === fence) fence = null;
			continue;
		}
		if (fence) continue;
		const detail = /^<details\b[^>]*\bid="([^"]+)"/.exec(line);
		if (detail) {
			retarget(null);
			rowId = detail[1];
			continue;
		}
		const summary = /^<summary>(.*)<\/summary>\s*$/.exec(line);
		if (summary && rowId) {
			const title = plainHeading(summary[1]);
			if (NOT_SEARCHABLE.has(title.toLowerCase())) retarget(null);
			else {
				const entry: DocsSection = {
					href,
					anchor: rowId,
					title,
					level: 3,
					summary: "",
				};
				sections.push(entry);
				retarget(entry);
			}
			rowId = null;
			continue;
		}
		if (!seenH1 && /^#\s+\S/.test(line)) {
			seenH1 = true;
			retarget(ledeSlot);
			continue;
		}
		const heading = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading) {
			const title = plainHeading(heading[2]);
			// Slug every heading so duplicate suffixes line up, then drop the
			// ones that are not worth a search row.
			const anchor = slugger.slug(title);
			if (NOT_SEARCHABLE.has(title.toLowerCase())) {
				retarget(null);
				continue;
			}
			const entry: DocsSection = {
				href,
				anchor,
				title,
				level: heading[1].length as 2 | 3,
				summary: "",
			};
			sections.push(entry);
			retarget(entry);
			continue;
		}
		if (!target) continue;
		if (!line.trim() || !isProse(line)) flush();
		else if (!target.summary) para.push(line.trim());
	}
	flush();
	return { lede: ledeSlot.summary, sections };
}

/** `##`/`###` headings and `<details id>` rows of one page's MDX. */
export function headingsFromMdx(href: string, source: string): DocsHeading[] {
	return sectionsFromMdx(href, source).sections.map(
		({ summary: _summary, ...heading }) => heading,
	);
}

/** Each hand-written docs page with its lede and sections, sidebar-ordered. */
async function scanDocsPages(): Promise<
	{ page: DocsPage; lede: string; sections: DocsSection[] }[]
> {
	const pages = docsPages().filter((p) => !GENERATED_PAGES.has(p.href));
	return Promise.all(
		pages.map(async (page) => {
			try {
				const source = await readFile(sourcePath(page.href), "utf8");
				return {
					page,
					...sectionsFromMdx(page.href, extractAgentNotes(source).rest),
				};
			} catch {
				return { page, lede: "", sections: [] };
			}
		}),
	);
}

/** Every searchable section of every hand-written docs page, sidebar-ordered. */
export async function docsHeadingIndex(): Promise<DocsHeading[]> {
	const scanned = await scanDocsPages();
	return scanned.flatMap((p) =>
		p.sections.map(({ summary: _summary, ...heading }) => heading),
	);
}

export type DocsSectionList = {
	pages: { href: string; title: string; lede: string }[];
	sections: { href: string; anchor: string; title: string; summary: string }[];
};

/**
 * The public section list the semantic finder reads: pages with their ledes,
 * sections with summaries. Summaries live here, not on `docsHeadingIndex`,
 * which ships to every docs page.
 */
export async function docsSectionList(): Promise<DocsSectionList> {
	const scanned = await scanDocsPages();
	return {
		pages: scanned.map(({ page, lede }) => ({
			href: page.href,
			title: page.title,
			lede,
		})),
		sections: scanned.flatMap((p) =>
			p.sections.map(({ href, anchor, title, summary }) => ({
				href,
				anchor,
				title,
				summary,
			})),
		),
	};
}

/** Markdown reduced to prose: no fences, links, markup, or tags. */
function proseOf(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[`*_>|#]/g, "")
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
	const pool = docsSearchPool(await docsHeadingIndex(), apiNav, docsPhrasings);
	const lines = new Map<string, string[]>();
	/** Sections of one page sharing a title are matched in document order. */
	const taken = new Map<string, number>();
	const docs: DocsSearchDoc[] = [];
	for (const item of pool) {
		const href = item.href ?? "";
		const [path, anchor] = href.split("#");
		const kind =
			item.sub === "endpoint" ? "endpoint" : anchor ? "section" : "page";
		let body = "";
		if (kind !== "endpoint") {
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
						/^#{2,3}\s/.test(l) &&
						plainHeading(l.replace(/^#+\s*/, "")) === item.label &&
						seen++ === skip,
				);
				if (start >= 0) {
					const rest: string[] = [];
					for (
						let i = start + 1;
						i < md.length && !/^#{1,3}\s/.test(md[i]);
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
