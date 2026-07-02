/**
 * Site-changelog guard.
 *
 * The public docs changelog (apps/web/src/app/(www)/docs/changelog/page.mdx)
 * is hand-written and feeds both /docs/changelog and the marketing pages'
 * "Recent highlights" — nothing flows into it from changesets. This guard
 * closes that gap: when `changeset version` produces a minor or major bump in
 * any public package, the same working tree must also touch the site
 * changelog, or the bump fails with instructions.
 *
 * Patch-only releases pass silently. Bypass a false positive with
 * SKIP_SITE_CHANGELOG=1 (e.g. an internal-only minor with no user-facing
 * surface).
 *
 * Chained onto the `version` script after check-changelogs.ts, so it runs at
 * bump time (dirty tree vs HEAD), which is exactly where the release flow is.
 *
 * Usage: bun run scripts/ci/check-site-changelog.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SITE_CHANGELOG = "apps/web/src/app/(www)/docs/changelog/page.mdx";

if (process.env.SKIP_SITE_CHANGELOG === "1") {
	console.log("Site-changelog guard skipped (SKIP_SITE_CHANGELOG=1).");
	process.exit(0);
}

function git(args: string[]): string {
	return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const pkgPaths = git([
	"ls-files",
	"packages/*/package.json",
	"apps/*/package.json",
])
	.split("\n")
	.filter(Boolean)
	.filter((p) => p.split("/").length === 3);

function parseSemver(v: string): [number, number, number] | null {
	const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const needsEntry: string[] = [];

for (const rel of pkgPaths) {
	const pkg = JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
	if (pkg.private) continue;

	let headRaw: string;
	try {
		headRaw = git(["show", `HEAD:${rel}`]);
	} catch {
		continue; // new package, no HEAD version to compare
	}
	const current = parseSemver(pkg.version ?? "");
	const previous = parseSemver(JSON.parse(headRaw).version ?? "");
	if (!current || !previous) continue;

	const majorBump = current[0] > previous[0];
	const minorBump = current[0] === previous[0] && current[1] > previous[1];
	if (majorBump || minorBump) {
		needsEntry.push(`${pkg.name} ${previous.join(".")} → ${pkg.version}`);
	}
}

if (needsEntry.length === 0) {
	console.log("Site-changelog guard passed: no minor/major bumps pending.");
	process.exit(0);
}

const siteChangelogDirty =
	git(["diff", "--name-only", "HEAD", "--", SITE_CHANGELOG]) !== "";

if (siteChangelogDirty) {
	console.log(
		`Site-changelog guard passed: ${SITE_CHANGELOG} updated alongside ${needsEntry.length} minor/major bump(s).`,
	);
	process.exit(0);
}

console.error(
	`Site-changelog guard failed. Minor/major bumps with no site changelog entry:\n${needsEntry
		.map((n) => `  ✗ ${n}`)
		.join("\n")}`,
);
console.error(
	`\nFix: add a "## <Product> — <Month Year>" entry with a "### <title>" block to\n  ${SITE_CHANGELOG}\n(it renders /docs/changelog and the marketing highlights), then re-run.\nInternal-only release? Bypass once with SKIP_SITE_CHANGELOG=1.`,
);
process.exit(1);
