/**
 * One-time CHANGELOG backfill.
 *
 * Between 2026-04-30 (commit 7fee04e2 flipped `.changeset/config.json`
 * `changelog` to `false`) and now, `changeset version` bumped package.json
 * versions but wrote no CHANGELOG entries. The consumed changeset `.md`
 * files still live in git history, so we reconstruct the missing entries
 * here, matching `@changesets/changelog-git` output format.
 *
 * Usage:
 *   bun run scripts/backfill-changelogs.ts          # dry-run, prints plan
 *   bun run scripts/backfill-changelogs.ts --apply  # writes CHANGELOG.md files
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const FREEZE = "7fee04e2"; // commit that set changelog:false
const APPLY = process.argv.includes("--apply");

function git(...args: string[]): string {
	return execFileSync("git", args, {
		cwd: ROOT,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}
function gitTry(...args: string[]): string | null {
	try {
		return git(...args);
	} catch {
		return null;
	}
}

// Workspace package.json files. git pathspec `*` crosses `/`, so the depth-3
// filter excludes nested template/fixture package.json files.
const PKG_GLOBS = ["packages/*/package.json", "apps/*/package.json"];

// name -> dir for every workspace package
const pkgDirs: Record<string, string> = {};
for (const dir of git("ls-files", ...PKG_GLOBS)
	.trim()
	.split("\n")
	.filter((p) => p.split("/").length === 3)) {
	const full = join(ROOT, dir);
	const name = JSON.parse(readFileSync(full, "utf8")).name as string;
	pkgDirs[name] = dir.replace(/\/package\.json$/, "");
}

function versionAt(commit: string, pkgPath: string): string | null {
	const raw = gitTry("show", `${commit}:${pkgPath}`);
	if (!raw) return null;
	try {
		return JSON.parse(raw).version ?? null;
	} catch {
		return null;
	}
}
function depsAt(commit: string, pkgPath: string): Record<string, string> {
	const raw = gitTry("show", `${commit}:${pkgPath}`);
	if (!raw) return {};
	try {
		const j = JSON.parse(raw);
		return {
			...(j.dependencies ?? {}),
			...(j.peerDependencies ?? {}),
			...(j.devDependencies ?? {}),
		};
	} catch {
		return {};
	}
}

function parseChangeset(content: string): {
	bumps: Record<string, string>;
	summary: string;
} {
	const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!m) return { bumps: {}, summary: content.trim() };
	const bumps: Record<string, string> = {};
	for (const line of m[1].split("\n")) {
		const lm = line.match(
			/^\s*["']?(@?[^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/,
		);
		if (lm) bumps[lm[1].trim()] = lm[2];
	}
	return { bumps, summary: m[2].trim() };
}

// Resolve the commit that introduced a changeset file (for the hash prefix).
const addCommitCache: Record<string, string> = {};
function addCommit(file: string): string {
	if (addCommitCache[file]) return addCommitCache[file];
	const log = gitTry("log", "--diff-filter=A", "--format=%h", "--", file);
	const hash = log ? (log.trim().split("\n").filter(Boolean).pop() ?? "") : "";
	addCommitCache[file] = hash;
	return hash;
}

type Release = {
	version: string;
	major: string[];
	minor: string[];
	patch: string[];
	deps: string[]; // "name@version" lines
};
// pkgName -> ordered (oldest first) list of releases
const releases: Record<string, Release[]> = {};

const commits = git(
	"rev-list",
	"--reverse",
	`${FREEZE}..HEAD`,
	"--",
	...PKG_GLOBS,
)
	.trim()
	.split("\n")
	.filter(Boolean);

const startCase = (t: string) => t[0].toUpperCase() + t.slice(1);

for (const commit of commits) {
	const status = git(
		"show",
		"--no-renames",
		"--name-status",
		"--format=",
		commit,
	).trim();
	if (!status) continue;
	const modifiedPkgJson: string[] = [];
	const consumed: string[] = [];
	for (const line of status.split("\n")) {
		const [st, path] = line.split("\t");
		if (!path) continue;
		if (
			/^(packages|apps)\/[^/]+\/package\.json$/.test(path) &&
			(st === "M" || st === "A")
		)
			modifiedPkgJson.push(path);
		if (
			st === "D" &&
			/^\.changeset\/.+\.md$/.test(path) &&
			!/README|config/.test(path)
		)
			consumed.push(path);
	}
	if (modifiedPkgJson.length === 0) continue;

	// Which packages actually changed version in this commit?
	const bumped: { name: string; path: string; version: string }[] = [];
	for (const path of modifiedPkgJson) {
		const cur = versionAt(commit, path);
		const prev = versionAt(`${commit}~1`, path);
		if (cur && cur !== prev && cur !== "0.0.0") {
			const name = Object.keys(pkgDirs).find(
				(n) => pkgDirs[n] === path.replace(/\/package\.json$/, ""),
			);
			if (name) bumped.push({ name, path, version: cur });
		}
	}
	if (bumped.length === 0) continue;

	// Parse consumed changesets for this commit.
	const csets = consumed.map((file) => {
		const add = addCommit(file);
		const content = add ? gitTry("show", `${add}:${file}`) : null;
		const parsed = content
			? parseChangeset(content)
			: { bumps: {}, summary: "" };
		return { file, hash: add, ...parsed };
	});

	for (const { name, path, version } of bumped) {
		const rel: Release = { version, major: [], minor: [], patch: [], deps: [] };
		for (const cs of csets) {
			const type = cs.bumps[name] as "major" | "minor" | "patch" | undefined;
			if (!type || !cs.summary) continue;
			const [first, ...rest] = cs.summary
				.split("\n")
				.map((l) => l.replace(/\s+$/, ""));
			const indented =
				rest.length > 0 ? `\n${rest.map((l) => `  ${l}`).join("\n")}` : "";
			const line = `- ${cs.hash ? `${cs.hash.slice(0, 7)}: ` : ""}${first}${indented}`;
			rel[type].push(line);
		}
		// Internal dependency version changes in this package.json this commit.
		const curDeps = depsAt(commit, path);
		const prevDeps = depsAt(`${commit}~1`, path);
		for (const dep of Object.keys(pkgDirs)) {
			if (curDeps[dep] && curDeps[dep] !== prevDeps[dep]) {
				const v = curDeps[dep].replace(/^[\^~]/, "").replace(/^workspace:/, "");
				if (/^\d/.test(v)) rel.deps.push(`  - ${dep}@${v}`);
			}
		}
		if (!releases[name]) releases[name] = [];
		releases[name].push(rel);
	}
}

function renderEntry(rel: Release): string {
	const sections: string[] = [`## ${rel.version}\n`];
	for (const type of ["major", "minor", "patch"] as const) {
		const lines = [...rel[type]];
		if (type === "patch" && rel.deps.length) {
			lines.push(["- Updated dependencies:", ...rel.deps].join("\n"));
		}
		if (lines.length)
			sections.push(`### ${startCase(type)} Changes\n\n${lines.join("\n")}\n`);
	}
	return sections.join("\n");
}

let totalEntries = 0;
for (const [name, rels] of Object.entries(releases)) {
	const dir = pkgDirs[name];
	const clPath = join(ROOT, dir, "CHANGELOG.md");
	const header = `# ${name}\n`;
	const existing = existsSync(clPath)
		? readFileSync(clPath, "utf8")
		: `${header}\n`;
	// Strip leading "# name" header so we can re-prepend new entries above old ones.
	const headerMatch = existing.match(/^#\s+.*\n+/);
	const body = headerMatch ? existing.slice(headerMatch[0].length) : existing;

	// Skip releases already present in the existing changelog (idempotent).
	const existingVersions = new Set(
		[...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim()),
	);
	const newRels = rels.filter((r) => !existingVersions.has(r.version));
	if (newRels.length === 0) {
		console.log(`${name}: up to date (${rels.length} releases, all present)`);
		continue;
	}
	// newest first
	const newBlock = newRels.slice().reverse().map(renderEntry).join("\n");
	const out = `${header}\n${newBlock}\n${body.trim() ? `\n${body.replace(/^\n+/, "")}` : ""}`;
	totalEntries += newRels.length;
	console.log(
		`${name}: +${newRels.length} entries (${newRels[newRels.length - 1].version} .. ${newRels[0].version})`,
	);
	if (APPLY)
		writeFileSync(clPath, out.replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n"));
}

console.log(
	`\n${APPLY ? "APPLIED" : "DRY-RUN"}: ${totalEntries} reconstructed entries across ${Object.keys(releases).length} packages`,
);
