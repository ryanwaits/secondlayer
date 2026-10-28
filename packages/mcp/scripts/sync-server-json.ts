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
const server = JSON.parse(await readFile(SERVER, "utf8")) as {
	version: string;
	packages: { version: string }[];
};

server.version = version;
for (const pkg of server.packages) pkg.version = version;

await writeFile(SERVER, `${JSON.stringify(server, null, "\t")}\n`);

console.log(`✓ packages/mcp/server.json — version ${version}`);
