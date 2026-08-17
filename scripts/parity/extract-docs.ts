/**
 * Parity-audit extractor for the documentation surfaces: the product agent
 * skill (skills/secondlayer) and the docs site (apps/web docs MDX + nav).
 *
 * Inventories every file/page and pulls MENTION TOKENS out of the markdown so
 * a later script can compute "is capability X documented on surface Y":
 *
 *   - cli:  `sl <cmd>` / `secondlayer <cmd>` invocations → "subgraphs deploy"
 *   - mcp:  snake_case tool names (only in mcp-titled files, to avoid
 *           mistaking data fields for tools)
 *   - sdk:  `sl.<ns>.<method>(` / `client.<ns>.<method>(` → "subgraphs.deploy"
 *   - http: `/v1/...` and `/api/...` path strings
 *
 * Extraction is heuristic and precision-leaning: tokens are only read from
 * code (fences + inline spans; example .ts files count whole), and each list
 * is deduped per file. Better to miss a mention than to fabricate one.
 *
 * Run from repo root:  bun scripts/parity/extract-docs.ts
 * Output:              scripts/parity/out/docs.json
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { docsNavPages } from "../../apps/web/src/app/(www)/docs/nav";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const SKILL_DIR = path.join(REPO_ROOT, "skills/secondlayer");
const DOCS_DIR = path.join(REPO_ROOT, "apps/web/src/app/(www)/docs");
const OUT_DIR = path.join(REPO_ROOT, "scripts/parity/out");

interface Mentions {
	cli: string[];
	mcp: string[];
	sdk: string[];
	http: string[];
}

interface SkillFile {
	path: string;
	mentions: Mentions;
}

interface SitePage {
	slug: string;
	title: string;
	group: string | null;
	mentions: Mentions;
}

// --- code-segment isolation -------------------------------------------------

/**
 * Mentions are only read from code: fenced blocks plus inline spans. Prose is
 * dropped so sentences like "the secondlayer instance" never become tokens.
 */
function codeSegments(markdown: string): string[] {
	const segments: string[] = [];
	const withoutFences = markdown.replace(
		/```[^\n]*\n([\s\S]*?)```/g,
		(_, body: string) => {
			segments.push(body);
			return "\n";
		},
	);
	for (const match of withoutFences.matchAll(/`([^`\n]+)`/g)) {
		segments.push(match[1]);
	}
	return segments;
}

// --- per-kind extractors ----------------------------------------------------

/**
 * `sl <words>` / `secondlayer <words>` → command path, capped at two words
 * (flags, placeholders, and dotted args stop the match naturally). The
 * lookbehind keeps `@secondlayer/cli` and `www.secondlayer.tools` out.
 */
const CLI_RE =
	/(?<![@/\w.-])(?:sl|secondlayer)[ \t]+([a-z][a-z0-9-]*(?:[ \t]+[a-z][a-z0-9-]*)?)/g;

function extractCli(segments: string[]): string[] {
	const out = new Set<string>();
	for (const segment of segments) {
		for (const match of segment.matchAll(CLI_RE)) {
			out.add(match[1].replace(/\s+/g, " "));
		}
	}
	return [...out];
}

/**
 * MCP tool names are bare snake_case tokens, which also describes half the
 * JSON fields on the platform — so this only runs on files whose path says
 * "mcp", where snake_case in code overwhelmingly means a tool name.
 */
const MCP_RE = /\b[a-z]+(?:_[a-z]+)+\b/g;

function extractMcp(segments: string[], filePath: string): string[] {
	if (!/(^|\/)mcp[./]/.test(filePath)) return [];
	const out = new Set<string>();
	for (const segment of segments) {
		for (const match of segment.matchAll(MCP_RE)) {
			out.add(match[0]);
		}
	}
	return [...out];
}

/**
 * SDK method chains: a call two members deep on the conventional client
 * variables (`sl`, `client`, `secondlayer`) → "ns.method". Unusual receiver
 * names are missed on purpose rather than guessing.
 */
const SDK_RE =
	/\b(?:sl|client|secondlayer)\.([a-z][A-Za-z0-9]*)\.([a-z][A-Za-z0-9]*)\s*\(/g;

function extractSdk(segments: string[]): string[] {
	const out = new Set<string>();
	for (const segment of segments) {
		for (const match of segment.matchAll(SDK_RE)) {
			out.add(`${match[1]}.${match[2]}`);
		}
	}
	return [...out];
}

/** `/v1/...` and `/api/...` paths; trailing slash/punctuation trimmed. */
const HTTP_RE = /(?:\/v1|\/api)(?:\/[A-Za-z0-9_{}:.$-]+)+/g;

function extractHttp(segments: string[]): string[] {
	const out = new Set<string>();
	for (const segment of segments) {
		for (const match of segment.matchAll(HTTP_RE)) {
			out.add(match[0].replace(/[/.,]+$/, ""));
		}
	}
	return [...out];
}

function extractMentions(content: string, filePath: string): Mentions {
	// Non-markdown files (example .ts) are code end to end.
	const segments = filePath.endsWith(".md") ? codeSegments(content) : [content];
	return {
		cli: extractCli(segments),
		mcp: extractMcp(segments, filePath),
		sdk: extractSdk(segments),
		http: extractHttp(segments),
	};
}

// --- skill surface ----------------------------------------------------------

function collectSkillFiles(): SkillFile[] {
	const relPaths = [
		"SKILL.md",
		...readdirSync(path.join(SKILL_DIR, "references"))
			.sort()
			.map((name) => `references/${name}`),
		...readdirSync(path.join(SKILL_DIR, "examples"))
			.sort()
			.map((name) => `examples/${name}`),
	];
	return relPaths.map((rel) => {
		const content = readFileSync(path.join(SKILL_DIR, rel), "utf8");
		return {
			path: `skills/secondlayer/${rel}`,
			mentions: extractMentions(content, rel),
		};
	});
}

// --- docs site surface ------------------------------------------------------

function findMdxPages(dir: string, prefix = ""): string[] {
	const pages: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		if (entry.isDirectory()) {
			pages.push(
				...findMdxPages(path.join(dir, entry.name), `${prefix}${entry.name}/`),
			);
		} else if (entry.name === "page.mdx") {
			pages.push(`${prefix}page.mdx`);
		}
	}
	return pages;
}

/** First `# Heading`, else the metadata title, for pages the nav omits. */
function inferTitle(content: string, slug: string): string {
	const heading = content.match(/^# (.+)$/m);
	if (heading) return heading[1].trim();
	const meta = content.match(/title:\s*"([^"]+)"/);
	if (meta) return meta[1].replace(/\s*—.*$/, "").trim();
	return slug;
}

function collectSitePages(): SitePage[] {
	const navBySlug = new Map(
		docsNavPages().map((page) => [page.href.replace(/^\//, ""), page]),
	);
	return findMdxPages(DOCS_DIR).map((rel) => {
		const dir = rel.slice(0, -"page.mdx".length).replace(/\/$/, "");
		const slug = dir === "" ? "docs" : `docs/${dir}`;
		const content = readFileSync(path.join(DOCS_DIR, rel), "utf8");
		const nav = navBySlug.get(slug);
		return {
			slug,
			title: nav?.title ?? inferTitle(content, slug),
			group: nav?.group ?? null,
			mentions: extractMentions(content, rel),
		};
	});
}

// --- main -------------------------------------------------------------------

const skillFiles = collectSkillFiles();
const sitePages = collectSitePages();

const output = {
	surface: "docs",
	generatedFrom: [
		"skills/secondlayer/",
		"apps/web/src/app/(www)/docs/",
		"apps/web/src/app/(www)/docs/nav.ts",
	],
	skill: { files: skillFiles },
	site: { pages: sitePages },
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
	path.join(OUT_DIR, "docs.json"),
	`${JSON.stringify(output, null, "\t")}\n`,
);

const tally = (files: { mentions: Mentions }[]) => {
	const sums = { cli: 0, mcp: 0, sdk: 0, http: 0 };
	for (const file of files) {
		for (const kind of Object.keys(sums) as (keyof Mentions)[]) {
			sums[kind] += file.mentions[kind].length;
		}
	}
	return sums;
};

console.log(`skill: ${skillFiles.length} files`, tally(skillFiles));
console.log(`site:  ${sitePages.length} pages`, tally(sitePages));
console.log("wrote scripts/parity/out/docs.json");
