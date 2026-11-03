/**
 * Derives the docs "New" rows from git history (rule: src/lib/docs-new-rule.mjs).
 *
 * `bun run docs:new` rewrites src/generated/docs-new.json as of today, the rows
 * the sidebar reads (it cannot read git in the browser). The pre-commit hook
 * runs it when a commit touches docs pages. `--as-of YYYY-MM-DD` prints the
 * rows for that date and writes nothing, to replay or tune the rule.
 *
 * Usage (from apps/web): bun run docs:new [--as-of YYYY-MM-DD]
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
		for (const file of chunk
			.slice(newline)
			.split(/^diff --git /m)
			.slice(1)) {
			const path = /^\+\+\+ b\/(.*)$/m.exec(file)?.[1];
			const route = path ? routeOf(path) : null;
			if (!route) continue;
			for (const line of file.split("\n")) {
				const text = /^\+#{2,3}\s+(.+?)\s*$/.exec(line)?.[1];
				if (!text) continue;
				const key = `${route}\x02${text.toLowerCase()}`;
				if (seen.has(key)) continue;
				seen.add(key);
				headings.push({ date, route, text });
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

	const diff = git(
		"show",
		"--no-renames",
		"--unified=0",
		"--format=",
		sha,
		"--",
		DOCS_GLOB,
	);
	const removed = new Set<string>();
	let added: string[] = [];
	for (const part of diff.split(/^diff --git /m).slice(1)) {
		const isPage = /^\+\+\+ b\/(.*)$/m.exec(part)?.[1] === addedPath;
		for (const line of part.split("\n")) {
			if (line.startsWith("-") && !line.startsWith("---")) {
				if (line.trim().length > MIN_MOVED_LINE)
					removed.add(line.slice(1).trim());
			} else if (isPage && line.startsWith("+") && !line.startsWith("+++")) {
				if (line.slice(1).trim()) added.push(line.slice(1).trim());
			}
		}
	}
	added = added.filter(Boolean);
	const moved = added.filter((line) => removed.has(line)).length;
	return {
		date,
		at: Number(at),
		route,
		lines: added.length,
		moved: moved / Math.max(1, added.length),
	};
}

/** `{ route: date }`: the docs rows that earn a "New" chip as of `asOf`. */
export function rowsAsOf(asOf: string): Record<string, string> {
	const rev = revisionAsOf(asOf);
	const files = new Map<string, string>();
	for (const path of git("ls-tree", "-r", "--name-only", rev).split("\n")) {
		const route = path.startsWith("apps/web/") ? routeOf(path) : null;
		if (route) files.set(route, path);
	}

	const pages = [];
	for (const [route, file] of files) {
		const page = readPage(rev, file, route);
		if (page) pages.push(page);
	}

	const sources = new Map<string, string>();
	const source = (route: string) => {
		let text = sources.get(route);
		if (text === undefined) {
			text = git("show", `${rev}:${files.get(route)}`).toLowerCase();
			sources.set(route, text);
		}
		return text;
	};

	return newRows(
		{
			feats: readFeats(rev, asOf),
			headings: readHeadings(rev, asOf),
			pages,
			exists: (route) => files.has(route),
			mentions: (route, term) =>
				source(route).match(new RegExp(termPattern(term), "g"))?.length ?? 0,
		},
		asOf,
	);
}

if (import.meta.main) {
	const flag = process.argv.indexOf("--as-of");
	if (flag === -1) {
		const today = new Date().toISOString().slice(0, 10);
		writeFileSync(OUT, `${JSON.stringify(rowsAsOf(today), null, "\t")}\n`);
	} else {
		const asOf = process.argv[flag + 1];
		if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? "")) {
			console.error("usage: docs-new.ts [--as-of YYYY-MM-DD]");
			process.exit(1);
		}
		console.log(JSON.stringify(rowsAsOf(asOf), null, "\t"));
	}
}
