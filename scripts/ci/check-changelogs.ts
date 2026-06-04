/**
 * CHANGELOG guard.
 *
 * Fails if any workspace package's package.json `version` does not match the
 * top-most `## <version>` header in its CHANGELOG.md. This catches the failure
 * mode where `changeset version` bumps package.json but writes no changelog
 * entry (e.g. `.changeset/config.json` `changelog` set to `false`).
 *
 * Runs in CI and is chained onto the `version` script so a broken changelog
 * pipeline fails the bump locally instead of shipping silently.
 *
 * Usage: bun run scripts/ci/check-changelogs.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const pkgPaths = execFileSync(
	"git",
	["ls-files", "packages/*/package.json", "apps/*/package.json"],
	{ cwd: ROOT, encoding: "utf8" },
)
	.trim()
	.split("\n")
	.filter(Boolean)
	// git pathspec `*` crosses `/`, so exclude nested template/fixture package.json files.
	.filter((p) => p.split("/").length === 3);

const failures: string[] = [];

for (const rel of pkgPaths) {
	const pkg = JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
	const { name, version, private: isPrivate } = pkg;
	const clPath = join(ROOT, dirname(rel), "CHANGELOG.md");

	if (!existsSync(clPath)) {
		// Published packages must have a changelog; private deploy-only ones may not.
		if (!isPrivate) failures.push(`${name}: published but has no CHANGELOG.md`);
		continue;
	}

	const top = readFileSync(clPath, "utf8").match(/^##\s+(.+?)\s*$/m)?.[1];
	if (!top) {
		failures.push(
			`${name}: CHANGELOG.md has no "## <version>" entry (current version ${version})`,
		);
	} else if (top !== version) {
		failures.push(
			`${name}: package.json version ${version} != CHANGELOG top ${top} — changeset version likely wrote no entry`,
		);
	}
}

if (failures.length) {
	console.error(
		`CHANGELOG guard failed:\n${failures.map((f) => `  ✗ ${f}`).join("\n")}`,
	);
	console.error(
		"\nFix: ensure `.changeset/config.json` `changelog` is enabled and re-run `bun run version`.",
	);
	process.exit(1);
}

console.log(
	`CHANGELOG guard passed: ${pkgPaths.length} packages, all versions match changelog tops.`,
);
