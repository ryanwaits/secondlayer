#!/usr/bin/env bun
/**
 * Bootstrap matrix — prove every supported install shape reports its coverage
 * honestly.
 *
 * The validation criterion is "honest scope states", and honesty is a specific,
 * checkable claim: an instance must never present absent history as present,
 * and must distinguish "I deliberately do not have this" (`out_of_scope`) from
 * "I should have this and it is missing" (`gap`). Those two look identical in a
 * row count and could not be more different to an operator deciding whether to
 * trust a query result.
 *
 * Each history shape gets a real database: migrated from scratch, seeded to
 * match the shape, then interrogated through the same code paths the product
 * uses (`resolveSyncScope`, `findGaps`, `evaluateCoverage`). The node-topology
 * shapes are config contracts rather than data states, so they are asserted
 * through `parseRuntimeConfig` — stated plainly here rather than dressed up as
 * something this harness boots.
 *
 * Usage:
 *   DATABASE_URL=postgres://…/postgres bun run scripts/ops/bootstrap-matrix.ts
 *   … --json
 */
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import {
	type CoverageState,
	evaluateCoverage,
} from "../../packages/shared/src/coverage/evaluate.ts";
import { findGaps } from "../../packages/shared/src/db/queries/integrity.ts";
import {
	resolveSyncScope,
	upsertSyncScope,
} from "../../packages/shared/src/db/queries/sync-scope.ts";
import type { Database } from "../../packages/shared/src/db/types.ts";
import { parseRuntimeConfig } from "../../packages/shared/src/runtime/config.ts";

const ADMIN_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/postgres";

type Check = { shape: string; name: string; ok: boolean; detail?: unknown };
const checks: Check[] = [];

function check(
	shape: string,
	name: string,
	ok: boolean,
	detail?: unknown,
): void {
	checks.push({ shape, name, ok, detail });
	if (!process.env.MATRIX_JSON) {
		const mark = ok ? "  ✓" : "  ✗";
		console.log(`${mark} ${name}`);
		if (!ok && detail !== undefined) {
			console.log(`      ${JSON.stringify(detail).slice(0, 300)}`);
		}
	}
}

function safeName(prefix: string): string {
	const name = `${prefix}_${Date.now().toString(36)}_${Math.floor(
		Math.random() * 1e6,
	).toString(36)}`;
	if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`unsafe name ${name}`);
	return name;
}

async function withDatabase<T>(
	prefix: string,
	fn: (db: Kysely<Database>, url: string) => Promise<T>,
): Promise<T> {
	const name = safeName(prefix);
	const admin = postgres(ADMIN_URL, { max: 1 });
	try {
		await admin.unsafe(`CREATE DATABASE ${name}`);
	} catch (error) {
		await admin.end();
		throw new Error(
			`could not create ${name}. Set DATABASE_URL to an admin connection. (${
				error instanceof Error ? error.message : error
			})`,
		);
	}
	await admin.end();

	const url = new URL(ADMIN_URL);
	url.pathname = `/${name}`;
	const href = url.toString();

	const client = postgres(href, { max: 4 });
	const db = new Kysely<Database>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});
	try {
		await migrate(href);
		return await fn(db, href);
	} finally {
		await db.destroy().catch(() => {});
		await client.end().catch(() => {});
		const cleanup = postgres(ADMIN_URL, { max: 1 });
		try {
			await cleanup.unsafe(
				`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${name}' AND pid <> pg_backend_pid()`,
			);
			await cleanup.unsafe(`DROP DATABASE IF EXISTS ${name}`);
		} finally {
			await cleanup.end();
		}
	}
}

async function migrate(databaseUrl: string): Promise<void> {
	const proc = Bun.spawn(["bun", "run", "packages/shared/src/db/migrate.ts"], {
		env: { ...process.env, DATABASE_URL: databaseUrl },
		stdout: "pipe",
		stderr: "pipe",
	});
	const code = await proc.exited;
	if (code !== 0) {
		const err = await new Response(proc.stderr).text();
		throw new Error(`migrations failed: ${err.slice(0, 400)}`);
	}
}

/** Seed a contiguous canonical run so scope questions have real data behind them. */
async function seedBlocks(
	db: Kysely<Database>,
	from: number,
	to: number,
): Promise<void> {
	for (let h = from; h <= to; h++) {
		await sql`
			INSERT INTO blocks (height, hash, parent_hash, burn_block_height, timestamp, canonical)
			VALUES (${h}, ${`0x${h.toString(16).padStart(8, "0")}`}, ${`0x${(h - 1).toString(16).padStart(8, "0")}`}, ${h}, ${1780000000 + h}, true)
			ON CONFLICT (height) DO NOTHING
		`.execute(db);
	}
}

/**
 * Ask the evaluator what a stage targeting `targetHeight` reports under this
 * scope. Below the declared start it must say `out_of_scope`.
 */
function stateForTarget(
	scope: Awaited<ReturnType<typeof resolveSyncScope>>,
	targetHeight: number,
): CoverageState {
	const observedAt = "2026-08-15T00:00:00.000Z";
	const report = evaluateCoverage({
		scope,
		stages: [
			{
				id: "decode",
				kind: "decode",
				depends_on: null,
				native_clock: "block",
				producer_version: "v1",
				repair_mode: "full_reindex",
				enabled: true,
			},
		],
		runs: [
			{
				stage_id: "decode",
				code_hash: "code",
				config_hash: "cfg",
				handler_hash: null,
				target_height: targetHeight,
				target_cursor: null,
				status: "complete",
				complete_through: targetHeight,
			},
		],
		evidence: [
			{
				stage_id: "decode",
				ranges: [{ from_height: scope.start_height, to_height: targetHeight }],
				open_failures: [],
				cursor: null,
				queue: null,
				unanchored: false,
				unverified_import: false,
				source_available: true,
			},
		],
		source: {
			tip_height: targetHeight,
			finalized_height: targetHeight,
			observed_at: observedAt,
		},
		options: { now: new Date(observedAt) },
	});
	return report.stages[0]?.state ?? "failed";
}

async function archiveShape(): Promise<void> {
	console.log("\narchive restore");
	await withDatabase("slm_archive", async (db) => {
		await seedBlocks(db, 1000, 1010);
		await upsertSyncScope(db, {
			network: "mainnet",
			start_height: 1000,
			target_height: null,
			bootstrap: {
				source: "archive",
				manifest_digest: "a".repeat(64),
				genesis_hash: null,
			},
		});
		const scope = await resolveSyncScope(db, "mainnet");
		check(
			"archive",
			"records the archive as the provenance",
			scope.bootstrap.source === "archive",
			scope,
		);
		check(
			"archive",
			"records the archive's LOW bound, not its tip",
			scope.start_height === 1000,
			scope,
		);
		check(
			"archive",
			"carries the manifest digest it restored from",
			!!scope.bootstrap.manifest_digest,
			scope,
		);

		const gaps = await findGaps(db);
		check(
			"archive",
			"the unindexed prefix is not reported as a gap",
			gaps.length === 0,
			gaps,
		);
		check(
			"archive",
			"history below the start reads out_of_scope",
			stateForTarget(scope, 500) === "out_of_scope",
		);
	});
}

async function genesisShape(): Promise<void> {
	console.log("\nfrom genesis");
	await withDatabase("slm_genesis", async (db) => {
		await seedBlocks(db, 0, 10);
		const scope = await resolveSyncScope(db, "mainnet");
		check("genesis", "starts at height 0", scope.start_height === 0, scope);
		check(
			"genesis",
			"claims genesis provenance",
			scope.bootstrap.source === "genesis",
			scope,
		);
		check(
			"genesis",
			"reports the real genesis hash",
			!!scope.bootstrap.genesis_hash,
			scope,
		);
		const gaps = await findGaps(db);
		check("genesis", "a contiguous chain has no gaps", gaps.length === 0, gaps);
	});
}

async function forwardOnlyShape(): Promise<void> {
	console.log("\nforward-only");
	await withDatabase("slm_forward", async (db) => {
		await seedBlocks(db, 8_000_000, 8_000_010);
		const scope = await resolveSyncScope(db, "mainnet");
		check(
			"forward-only",
			"starts where the data starts",
			scope.start_height === 8_000_000,
			scope,
		);
		check(
			"forward-only",
			"does not claim archive or genesis provenance it cannot prove",
			scope.bootstrap.source === "import",
			scope,
		);
		// The distinction the whole shape exists to make.
		const gaps = await findGaps(db);
		check(
			"forward-only",
			"the absent prefix is NOT a gap",
			gaps.length === 0,
			gaps,
		);
		check(
			"forward-only",
			"the absent prefix IS out_of_scope",
			stateForTarget(scope, 1_000_000) === "out_of_scope",
		);
	});
}

async function realGapIsStillReported(): Promise<void> {
	console.log("\ncontrol: a real hole must still be a gap");
	await withDatabase("slm_gap", async (db) => {
		await seedBlocks(db, 100, 105);
		await seedBlocks(db, 110, 115);
		const gaps = await findGaps(db);
		// Without this the other checks are vacuous: a findGaps that reports
		// nothing for everything would "pass" every honesty assertion above.
		check(
			"control",
			"a hole inside the covered range is reported",
			gaps.length > 0,
			gaps,
		);
	});
}

function nodeTopologyShapes(): void {
	console.log("\nnode topology (config contracts, not booted here)");
	const base = {
		NETWORK: "mainnet",
		DATABASE_URL: "postgres://x@y/z",
		DATA_DIR: "/data",
		API_PORT: "3800",
		INDEXER_PORT: "3700",
	};
	const external = parseRuntimeConfig({ ...base, NODE_MODE: "external" });
	check(
		"external-node",
		"external node config is accepted",
		external.ok,
		external,
	);

	const externalWithPassword = parseRuntimeConfig({
		...base,
		NODE_MODE: "external",
		BITCOIN_RPC_PASSWORD: "x",
	});
	check(
		"external-node",
		"external node rejects bundled-bitcoin credentials",
		!externalWithPassword.ok,
	);

	const bundled = parseRuntimeConfig({
		...base,
		NODE_MODE: "full",
		BITCOIN_RPC_PASSWORD: "x",
	});
	check("bundled-node", "bundled node config is accepted", bundled.ok, bundled);

	const bundledNoPassword = parseRuntimeConfig({ ...base, NODE_MODE: "full" });
	check(
		"bundled-node",
		"bundled node without bitcoin credentials is refused",
		!bundledNoPassword.ok,
	);
}

async function main(): Promise<void> {
	await archiveShape();
	await genesisShape();
	await forwardOnlyShape();
	await realGapIsStillReported();
	nodeTopologyShapes();

	const failed = checks.filter((c) => !c.ok);
	if (process.env.MATRIX_JSON || process.argv.includes("--json")) {
		console.log(
			JSON.stringify(
				{ ok: failed.length === 0, total: checks.length, checks },
				null,
				2,
			),
		);
	} else {
		console.log(
			failed.length === 0
				? `\nbootstrap matrix: ${checks.length} checks passed`
				: `\nbootstrap matrix: ${failed.length}/${checks.length} FAILED`,
		);
	}
	process.exit(failed.length === 0 ? 0 : 1);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
