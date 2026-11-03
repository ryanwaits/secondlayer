/**
 * Derives the docs "New" rows from git history (rule: src/lib/docs-new-rule.mjs).
 *
 * `bun run docs:new` rewrites src/generated/docs-new.json as of today, the rows
 * the sidebar reads (it cannot read git in the browser). `--staged` does the
 * same but counts the staged diff as one more commit authored now; the
 * pre-commit hook runs it when a commit touches docs pages, so a commit's own
 * new page or heading badges at once. `--as-of YYYY-MM-DD` prints the rows for
 * that date and writes nothing, to replay or tune the rule.
 *
 * Usage (from apps/web): bun run docs:new [--staged | --as-of YYYY-MM-DD]
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { newRows, termPattern } from "../src/lib/docs-new-rule.mjs";

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const OUT = join(import.meta.dir, "..", "src", "generated", "docs-new.json");
const DOCS_GLOB = ":(glob)apps/web/**/docs/**/page.mdx";
const DOCS_PAGE = /\/docs\/(.*?)\/?page\.mdx$/;
const FEAT = /^feat(?:\(([^)]*)\))?!?:\s*(.*)$/;

/**
 * Removed lines shorter than this are too generic (a fence, a rule) to prove a
 * page's text was moved rather than written.
 */
const MIN_MOVED_LINE = 20;

/**
 * Runs git at the repo root with the repo-locating env stripped: a hook inside
 * a linked worktree sets GIT_DIR, which would otherwise misdirect every call.
 */
function git(...args: string[]): string {
	const env = { ...process.env };
	for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
		delete env[key];
	}
	return execFileSync("git", args, {
		cwd: ROOT,
		env,
		encoding: "utf8",
		maxBuffer: 1024 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/** `/docs/<slug>` for a docs page path; `/docs` for the docs root page. */
function routeOf(path: string): string | null {
	const match = DOCS_PAGE.exec(path);
	if (!match) return null;
	const slug = match[1].replace(/\/$/, "");
	return slug ? `/docs/${slug}` : "/docs";
}

/** The last commit authored on or before `asOf`. */
function revisionAsOf(asOf: string): string {
	for (const line of git("log", "--format=%H %as").split("\n")) {
		const [sha, date] = line.split(" ");
		if (sha && date <= asOf) return sha;
	}
	throw new Error(`no commit on or before ${asOf}`);
}

type Feat = { date: string; scope: string; subject: string };
type Heading = { date: string; route: string; text: string };

function readFeats(rev: string, asOf: string): Feat[] {
	const feats: Feat[] = [];
	for (const line of git("log", "--no-merges", "--format=%as%x02%s", rev).split(
		"\n",
	)) {
		const [date, subject = ""] = line.split("\x02");
		const match = FEAT.exec(subject);
		if (match && date <= asOf) {
			feats.push({
				date,
				scope: (match[1] ?? "").toLowerCase(),
				subject: match[2].toLowerCase(),
			});
		}
	}
	return feats;
}

type DiffFile = {
	path: string;
	route: string;
	/** The diff creates this file. */
	created: boolean;
	/** Non-blank added lines, trimmed. */
	added: string[];
	/** Text of each `##` / `###` heading the diff adds. */
	headings: string[];
};

/**
 * What a `--unified=0 --no-renames` diff of docs pages adds and removes. The
 * one reader for committed history and for the staged diff alike. `removed`
 * spans every file in the diff, deletions included, so a page moved in one
 * change shows its old lines.
 */
export function parseDocsDiff(diff: string): {
	files: DiffFile[];
	removed: Set<string>;
} {
	const files: DiffFile[] = [];
	const removed = new Set<string>();
	for (const part of diff.split(/^diff --git /m).slice(1)) {
		const cut = part.search(/^@@/m);
		const header = cut === -1 ? part : part.slice(0, cut);
		const body = cut === -1 ? "" : part.slice(cut);
		const path = /^\+\+\+ b\/(.*)$/m.exec(header)?.[1];
		const route = path ? routeOf(path) : null;
		const file: DiffFile | null =
			path && route
				? {
						path,
						route,
						created: /^new file mode/m.test(header),
						added: [],
						headings: [],
					}
				: null;
		for (const line of body.split("\n")) {
			const text = line.slice(1).trim();
			if (line.startsWith("-")) {
				if (text.length > MIN_MOVED_LINE) removed.add(text);
			} else if (file && line.startsWith("+")) {
				if (text) file.added.push(text);
				const heading = /^#{2,3}\s+(.+?)\s*$/.exec(text)?.[1];
				if (heading) file.headings.push(heading);
			}
		}
		if (file) files.push(file);
	}
	return { files, removed };
}

/** The non-blank lines a file adds, and the share that was moved from elsewhere. */
function pageStats(file: DiffFile, removed: Set<string>) {
	const moved = file.added.filter((line) => removed.has(line)).length;
	return {
		lines: file.added.length,
		moved: moved / Math.max(1, file.added.length),
	};
}

const headingKey = (route: string, text: string) =>
	`${route}\x02${text.toLowerCase()}`;

/** The first time each heading is added to each docs page, up to `asOf`. */
function readHeadings(rev: string, asOf: string): Heading[] {
	const log = git(
		"log",
		"--reverse",
		"--no-merges",
		"--no-renames",
		"--unified=0",
		"-p",
		"--format=%x01%H%x02%as",
		rev,
		"--",
		DOCS_GLOB,
	);
	const headings: Heading[] = [];
	const seen = new Set<string>();
	for (const chunk of log.split("\x01").slice(1)) {
		const newline = chunk.indexOf("\n");
		const date = chunk.slice(0, newline).split("\x02")[1];
		if (date > asOf) continue;
		for (const file of parseDocsDiff(chunk.slice(newline)).files) {
			for (const text of file.headings) {
				const key = headingKey(file.route, text);
				if (seen.has(key)) continue;
				seen.add(key);
				headings.push({ date, route: file.route, text });
			}
		}
	}
	return headings;
}

/** A page's first add and what it brought, from that commit's diff. */
function readPage(rev: string, file: string, route: string) {
	const adds = git(
		"log",
		"--follow",
		"--diff-filter=A",
		"--name-only",
		"--format=%x01%H%x02%as%x02%at",
		rev,
		"--",
		file,
	)
		.split("\x01")
		.filter(Boolean);
	const last = adds[adds.length - 1];
	if (!last) return null;
	const [head, ...names] = last.split("\n");
	const [sha, date, at] = head.split("\x02");
	const addedPath = names.find(Boolean) ?? file;

	const { files, removed } = parseDocsDiff(
		git(
			"show",
			"--no-renames",
			"--unified=0",
			"--format=",
			sha,
			"--",
			DOCS_GLOB,
		),
	);
	const added = files.find((f) => f.path === addedPath);
	if (!added) return null;
	return { date, at: Number(at), route, ...pageStats(added, removed) };
}

/**
 * What the staged diff adds, as history dated `today`: its headings, and each
 * page it creates. A staged rename shows here as a creation too; the caller
 * swaps in the page's original first add.
 */
export function stagedChanges(diff: string, today: string, at: number) {
	const { files, removed } = parseDocsDiff(diff);
	return {
		headings: files.flatMap((file) =>
			file.headings.map((text) => ({ date: today, route: file.route, text })),
		),
		pages: files
			.filter((file) => file.created)
			.map((file) => ({
				path: file.path,
				date: today,
				at,
				route: file.route,
				...pageStats(file, removed),
			})),
	};
}

/**
 * `{ route: date }`: the docs rows that earn a "New" chip as of `asOf`. With
 * `staged`, as of today, and the index counts as one more commit authored now:
 * a heading or page the commit adds counts at once, and a staged deletion
 * removes its page.
 */
export function rowsAsOf(asOf: string, staged = false): Record<string, string> {
	const rev = revisionAsOf(asOf);
	const files = new Map<string, string>();
	const listing = staged
		? git("ls-files")
		: git("ls-tree", "-r", "--name-only", rev);
	for (const path of listing.split("\n")) {
		const route = path.startsWith("apps/web/") ? routeOf(path) : null;
		if (route) files.set(route, path);
	}

	const headings = readHeadings(rev, asOf);
	const created = new Map<
		string,
		ReturnType<typeof stagedChanges>["pages"][number]
	>();
	/** New path -> old path, for pages the index renames. */
	const renamedFrom = new Map<string, string>();
	if (staged) {
		const change = stagedChanges(
			git("diff", "--cached", "--no-renames", "--unified=0", "--", DOCS_GLOB),
			asOf,
			Math.floor(Date.now() / 1000),
		);
		const seen = new Set(headings.map((h) => headingKey(h.route, h.text)));
		for (const heading of change.headings) {
			const key = headingKey(heading.route, heading.text);
			if (seen.has(key)) continue;
			seen.add(key);
			headings.push(heading);
		}
		for (const page of change.pages) created.set(page.path, page);
		for (const line of git(
			"diff",
			"--cached",
			"-M",
			"--diff-filter=R",
			"--name-status",
		).split("\n")) {
			const [status, from, to] = line.split("\t");
			if (status?.startsWith("R") && from && to) renamedFrom.set(to, from);
		}
	}

	const pages = [];
	for (const [route, file] of files) {
		const staging = created.get(file);
		const from = renamedFrom.get(file);
		const page = from
			? readPage(rev, from, route)
			: staging
				? staging
				: readPage(rev, file, route);
		if (page) pages.push(page);
	}

	const sources = new Map<string, string>();
	const source = (route: string) => {
		let text = sources.get(route);
		if (text === undefined) {
			const path = files.get(route);
			text = git("show", staged ? `:${path}` : `${rev}:${path}`).toLowerCase();
			sources.set(route, text);
		}
		return text;
	};

	return newRows(
		{
			feats: readFeats(rev, asOf),
			headings,
			pages,
			exists: (route) => files.has(route),
			mentions: (route, term) =>
				source(route).match(new RegExp(termPattern(term), "g"))?.length ?? 0,
		},
		asOf,
	);
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const flag = args.indexOf("--as-of");
	const staged = args.includes("--staged");
	const today = new Date().toISOString().slice(0, 10);
	if (flag === -1) {
		writeFileSync(
			OUT,
			`${JSON.stringify(rowsAsOf(today, staged), null, "\t")}\n`,
		);
	} else {
		const asOf = args[flag + 1];
		if (staged || !/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? "")) {
			console.error("usage: docs-new.ts [--staged | --as-of YYYY-MM-DD]");
			process.exit(1);
		}
		console.log(JSON.stringify(rowsAsOf(asOf), null, "\t"));
	}
}
