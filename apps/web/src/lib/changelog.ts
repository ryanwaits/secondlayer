import { readFileSync } from "node:fs";
import { join } from "node:path";
import GitHubSlugger from "github-slugger";

/**
 * Single source of truth for the changelog: the docs/changelog MDX file.
 * It renders the full /docs/changelog page (via MDX) and — parsed here — also
 * feeds the "Recent highlights" sections on the product marketing pages. Write
 * one markdown entry, and both stay in sync on the next deploy.
 *
 * Each `### Entry` under a `## Product — Date` heading becomes an entry. Slugs
 * are produced with github-slugger in document order so they match the anchor
 * ids rehype-slug emits on the rendered page (see next.config.ts), which makes
 * `href` deep-link straight to the entry's section.
 */
export type ChangelogEntry = {
	/** lowercased product, e.g. "index" | "subgraphs" */
	product: string;
	/** display label, e.g. "Index" */
	productLabel: string;
	/** e.g. "June 2026" */
	date: string;
	title: string;
	/** rehype-slug-compatible anchor id */
	slug: string;
	/** plain-text first paragraph */
	summary: string;
	/** "/docs/changelog#<slug>" */
	href: string;
};

const CHANGELOG_PATH = join(
	process.cwd(),
	"src/app/(www)/docs/changelog/page.mdx",
);

function stripMarkdown(text: string): string {
	return text
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

let cache: ChangelogEntry[] | null = null;

export function getChangelogEntries(): ChangelogEntry[] {
	if (cache) return cache;

	let raw: string;
	try {
		raw = readFileSync(CHANGELOG_PATH, "utf8");
	} catch {
		return [];
	}

	const lines = raw.split("\n");
	const slugger = new GitHubSlugger();
	const entries: ChangelogEntry[] = [];
	let product = "";
	let productLabel = "";
	let date = "";
	let inFence = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (!heading) continue;

		const level = heading[1].length;
		const text = heading[2].trim();
		// Slug every heading in order so dedup state matches rehype-slug.
		const slug = slugger.slug(text);

		if (level === 2) {
			const [label, when] = text.split(/\s+—\s+/);
			productLabel = (label ?? text).trim();
			product = productLabel.toLowerCase();
			date = (when ?? "").trim();
			continue;
		}

		if (level === 3 && product) {
			const buf: string[] = [];
			for (let j = i + 1; j < lines.length; j++) {
				const l = lines[j];
				if (l.startsWith("```") || /^#{1,6}\s/.test(l)) break;
				if (l.trim() === "") {
					if (buf.length) break;
					continue;
				}
				buf.push(l.trim());
			}
			entries.push({
				product,
				productLabel,
				date,
				title: text,
				slug,
				summary: stripMarkdown(buf.join(" ")),
				href: `/docs/changelog#${slug}`,
			});
		}
	}

	cache = entries;
	return entries;
}

/** Latest entries for a product (document order = reverse-chronological). */
export function getHighlights(product: string, limit = 3): ChangelogEntry[] {
	return getChangelogEntries()
		.filter((entry) => entry.product === product)
		.slice(0, limit);
}
