import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DOCS_NAV } from "@/app/(www)/docs/nav";

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

export type DocsPage = { href: string; title: string; group: string };

/** Every page in the sidebar, in sidebar order. */
export function docsPages(): DocsPage[] {
	return DOCS_NAV.flatMap((group) =>
		group.items.map((item) => ({
			href: item.href,
			title: item.title,
			group: group.label,
		})),
	);
}

/** `/docs/subgraphs` → `<docs>/subgraphs/page.mdx`; `/docs` → `<docs>/page.mdx`. */
function sourcePath(href: string): string {
	const rel = href.replace(/^\/docs\/?/, "");
	return rel ? join(DOCS_ROOT, rel, "page.mdx") : join(DOCS_ROOT, "page.mdx");
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
export async function readDocsMarkdown(href: string): Promise<string | null> {
	const page = docsPages().find((p) => p.href === href);
	if (!page) return null;
	try {
		const source = await readFile(sourcePath(href), "utf8");
		return mdxToMarkdown(source);
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
		const md = await readDocsMarkdown(page.href);
		if (!md) continue;
		parts.push(
			`<!-- source: https://secondlayer.tools${page.href} -->\n` +
				`# ${page.group} / ${page.title}\n\n${md}`,
		);
	}
	return parts.join("\n\n---\n\n");
}
