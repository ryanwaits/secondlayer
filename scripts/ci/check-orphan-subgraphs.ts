#!/usr/bin/env bun
/**
 * Orphan-subgraph guard — fails when a deployed first-party subgraph has no
 * committed source in this repo.
 *
 * It has happened twice: `contract-deployments` (recovered, see
 * plans/archive/chore-f058-commit-orphan-subgraph-source.md) and
 * `asset-holdings` (found orphaned 2026-08-02, 28,028 rows, source only ever
 * lived as two database columns). Without a check this is invisible until
 * someone happens to look.
 *
 * The `subgraphs` table holds every subgraph, including customer/tenant
 * ones — those legitimately have no source here. Scope is limited to the
 * first-party `account_id` (see FIRST_PARTY_ACCOUNT_ID below), never to
 * `visibility` alone, since a customer can publish a public subgraph too.
 *
 * `subgraphs` is a control-plane table (packages/shared/migrations/0075_...),
 * so under the source/target DB split it lives on TARGET, not SOURCE — see
 * packages/shared/src/db/migration-role.ts:1-23.
 *
 * What fails vs. what merely notices:
 *   - Deployed first-party subgraph with no committed source → fail.
 *   - Committed source with no deployed counterpart → notice (probably just
 *     written but not deployed yet).
 *   - No DB connection string configured → notice + skip, NOT a failure.
 *     This is deliberate: the scheduled workflow lands green before the
 *     PLATFORM_DATABASE_URL secret exists, and starts doing real work the
 *     moment it's added. A guard that fails red from day one gets disabled,
 *     not fixed.
 *
 * Names source precedence: ORPHAN_DEPLOYED_NAMES_FILE (newline-separated
 * deployed names, no DB access needed) > TARGET_DATABASE_URL (direct SQL) >
 * skip-notice. The file mode exists because no GitHub-hosted runner can
 * reach prod Postgres directly — CI populates the file via an SSH step
 * against the deploy host instead (see orphan-subgraph-guard.yml).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const NAMES_FILE = process.env.ORPHAN_DEPLOYED_NAMES_FILE || "";
const DB_URL =
	process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL || "";
const FIRST_PARTY_ACCOUNT_ID =
	process.env.FIRST_PARTY_ACCOUNT_ID || "005f2b11-9fb0-4dda-aef4-a80428426d9d";

const SUBGRAPHS_DIR = join(import.meta.dir, "..", "..", "subgraphs");

const failures: string[] = [];
const notices: string[] = [];

function committedSubgraphFiles(dir: string): string[] {
	return readdirSync(dir).filter(
		(f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
	);
}

function isCovered(
	deployedName: string,
	files: string[],
	dir: string,
): boolean {
	if (files.includes(`${deployedName}.ts`)) return true;
	const pattern = new RegExp(
		`name:\\s*["']${deployedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
	);
	return files.some((f) => pattern.test(readFileSync(join(dir, f), "utf8")));
}

/** Reads names from ORPHAN_DEPLOYED_NAMES_FILE (one per line, blanks
 *  dropped). Bypasses the DB entirely — used when CI populates the file
 *  itself (e.g. via SSH against the deploy host). */
function namesFromFile(path: string): string[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/** Queries deployed names directly from TARGET_DATABASE_URL. */
async function namesFromDb(dbUrl: string): Promise<string[]> {
	// Bun.SQL replaces pg/postgres.js per project stack convention.
	const db = new Bun.SQL(dbUrl);
	try {
		const rows = await db`
			SELECT name FROM subgraphs WHERE account_id = ${FIRST_PARTY_ACCOUNT_ID} ORDER BY name
		`;
		return rows.map((r: { name: string }) => r.name);
	} finally {
		await db.close();
	}
}

async function checkOrphanSubgraphs(): Promise<void> {
	if (!NAMES_FILE && !DB_URL) {
		notices.push("skipped (TARGET_DATABASE_URL not set)");
		return;
	}

	let deployedNames: string[] = [];
	try {
		deployedNames = NAMES_FILE
			? namesFromFile(NAMES_FILE)
			: await namesFromDb(DB_URL);
	} catch (err) {
		failures.push(
			`orphan subgraph check: ${NAMES_FILE ? "reading names file" : "query"} failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		return;
	}

	if (deployedNames.length > 10) {
		failures.push(
			`orphan subgraph check: ${deployedNames.length} first-party subgraphs found (expected ~5) — FIRST_PARTY_ACCOUNT_ID likely wrong`,
		);
		return;
	}

	const files = committedSubgraphFiles(SUBGRAPHS_DIR);

	for (const name of deployedNames) {
		if (!isCovered(name, files, SUBGRAPHS_DIR)) {
			failures.push(
				`${name}: deployed but no committed source. Recover with: echo "SELECT source_code FROM subgraphs WHERE name='${name}';" | psql "$TARGET_DATABASE_URL" > subgraphs/${name}.ts`,
			);
		}
	}

	const deployedSet = new Set(deployedNames);
	for (const file of files) {
		const contents = readFileSync(join(SUBGRAPHS_DIR, file), "utf8");
		const match = contents.match(/name:\s*["']([^"']+)["']/);
		const declaredName = match ? match[1] : file.replace(/\.ts$/, "");
		if (!deployedSet.has(declaredName)) {
			notices.push(`${file}: committed but not deployed (no matching row)`);
		}
	}

	console.log(
		`orphan subgraph check: ${deployedNames.length} first-party subgraph(s) checked`,
	);
}

await checkOrphanSubgraphs();

for (const notice of notices) console.log(notice);
if (failures.length > 0) {
	for (const failure of failures) console.error(failure);
	console.error(`orphan subgraph check failed: ${failures.length}`);
	process.exit(1);
}
console.log("orphan subgraph check passed");
