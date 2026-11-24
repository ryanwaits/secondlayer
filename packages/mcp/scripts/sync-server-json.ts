/**
 * Keeps server.json (the official MCP registry manifest) in step with the
 * package version, so a release never ships a stale registry version.
 *
 * Run from packages/mcp:  bun run tools  (chained after sync-tools.ts)
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PACKAGE = join(ROOT, "package.json");
const SERVER = join(ROOT, "server.json");

const { version } = JSON.parse(await readFile(PACKAGE, "utf8")) as {
	version: string;
};
const text = await readFile(SERVER, "utf8");
const current = JSON.parse(text) as {
	version: string;
	packages: { version: string }[];
};
const owned = new Set([
	current.version,
	...current.packages.map((pkg) => pkg.version),
]);

const next = text.replace(
	/("version"\s*:\s*")([^"]+)(")/g,
	(match, open: string, value: string, close: string) =>
		owned.has(value) ? `${open}${version}${close}` : match,
);

const synced = JSON.parse(next) as typeof current;
for (const found of [
	synced.version,
	...synced.packages.map((p) => p.version),
]) {
	if (found !== version) {
		throw new Error(`server.json version ${found} did not sync to ${version}`);
	}
}

if (next !== text) await writeFile(SERVER, next);

console.log(`✓ packages/mcp/server.json — version ${version}`);
