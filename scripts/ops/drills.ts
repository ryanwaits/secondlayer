#!/usr/bin/env bun
/**
 * Corruption drills — break it on purpose, prove we notice, prove we can fix it.
 *
 * We could already DETECT corruption well; what did not exist was any way to
 * CAUSE it on demand, so the detectors were never exercised against real damage
 * outside of unit fixtures. This is that missing half.
 *
 * Every drill asserts the detector twice: silent on healthy data, loud after the
 * break. Both directions are required. A detector that fires on everything
 * would pass a "did it fire?" check while being useless, and one that fires on
 * nothing would pass every honesty assertion by saying nothing at all — that is
 * how a green drill suite ends up proving nothing.
 *
 * Recovery needs a signed archive, because repairing from anything less
 * trustworthy is how you launder corruption into the chain. Without one, the
 * repair half is reported SKIPPED with its reason rather than passed.
 *
 * Usage:
 *   DATABASE_URL=postgres://…/postgres bun run scripts/ops/drills.ts
 *   … --against <manifest>   # unlocks the repair half
 *   … --json
 */
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { planTornImport } from "../../packages/cli/src/lib/bootstrap-resume.ts";
import {
	findBrokenLinks,
	findGaps,
} from "../../packages/shared/src/db/queries/integrity.ts";
import type { Database } from "../../packages/shared/src/db/types.ts";
import { signStreamsBulkManifest } from "../../packages/shared/src/streams-bulk-manifest.ts";

const ADMIN_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const args = process.argv.slice(2);
const AGAINST = args.includes("--against")
	? args[args.indexOf("--against") + 1]
	: undefined;
const JSON_OUT = args.includes("--json");

type Status = "pass" | "fail" | "skip";
type Result = { drill: string; step: string; status: Status; detail: string };
const results: Result[] = [];

function record(
	drill: string,
	step: string,
	status: Status,
	detail: string,
): void {
	results.push({ drill, step, status, detail });
	if (!JSON_OUT) {
		const mark = status === "pass" ? "  ✓" : status === "skip" ? "  –" : "  ✗";
		console.log(`${mark} ${step} — ${detail}`);
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
	} finally {
		await admin.end();
	}
	const url = new URL(ADMIN_URL);
	url.pathname = `/${name}`;
	const href = url.toString();

	const client = postgres(href, { max: 4 });
	const db = new Kysely<Database>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});
	try {
		const migrated = spawnSync(
			"bun",
			["run", "packages/shared/src/db/migrate.ts"],
			{ env: { ...process.env, DATABASE_URL: href }, encoding: "utf8" },
		);
		if (migrated.status !== 0) {
			throw new Error(`migrations failed: ${migrated.stderr?.slice(0, 300)}`);
		}
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

function blockHash(height: number): string {
	return `0x${height.toString(16).padStart(16, "0")}`;
}

/** A contiguous, correctly linked canonical run — the healthy baseline. */
async function seedHealthy(
	db: Kysely<Database>,
	from: number,
	to: number,
): Promise<void> {
	for (let h = from; h <= to; h++) {
		await sql`
			INSERT INTO blocks (height, hash, parent_hash, burn_block_height, timestamp, canonical)
			VALUES (${h}, ${blockHash(h)}, ${blockHash(h - 1)}, ${h}, ${1780000000 + h}, true)
			ON CONFLICT (height) DO NOTHING
		`.execute(db);
	}
}

/** Run the product's repair, or report why it could not run. */
function repair(databaseUrl: string): { status: Status; detail: string } {
	if (!AGAINST) {
		return {
			status: "skip",
			detail: "no --against <manifest>; repair needs a signed archive",
		};
	}
	const res = spawnSync(
		"bun",
		[
			"run",
			"packages/cli/src/cli.ts",
			"repair",
			"--against",
			AGAINST,
			"--apply",
		],
		{
			env: { ...process.env, DATABASE_URL: databaseUrl },
			encoding: "utf8",
		},
	);
	return res.status === 0
		? { status: "pass", detail: "repair --apply completed" }
		: {
				status: "fail",
				detail: `repair exited ${res.status}: ${(res.stderr ?? "").slice(0, 160)}`,
			};
}

// ── drill 1: a block goes missing ──────────────────────────────────────────
async function drillMissingBlock(): Promise<void> {
	console.log("\nmissing block");
	await withDatabase("sld_gap", async (db, url) => {
		await seedHealthy(db, 100, 120);

		const before = await findGaps(db);
		record(
			"missing block",
			"detector is silent on healthy data",
			before.length === 0 ? "pass" : "fail",
			before.length === 0 ? "no gaps reported" : JSON.stringify(before),
		);

		await sql`DELETE FROM blocks WHERE height = 110`.execute(db);

		const after = await findGaps(db);
		const found = after.length > 0;
		record(
			"missing block",
			"detector reports the hole",
			found ? "pass" : "fail",
			found ? `gap reported: ${JSON.stringify(after[0])}` : "no gap reported",
		);

		const fixed = repair(url);
		record(
			"missing block",
			"repair restores the block",
			fixed.status,
			fixed.detail,
		);
	});
}

// ── drill 2: ancestry is broken ────────────────────────────────────────────
async function drillBrokenAncestry(): Promise<void> {
	console.log("\nbroken ancestry");
	await withDatabase("sld_link", async (db, url) => {
		await seedHealthy(db, 200, 220);

		const before = await findBrokenLinks(db);
		record(
			"broken ancestry",
			"detector is silent on a correctly linked chain",
			before.length === 0 ? "pass" : "fail",
			before.length === 0 ? "no broken links" : JSON.stringify(before[0]),
		);

		// The block still exists and the height sequence is intact — only the
		// parent pointer lies. A gap check cannot see this; only a link check can.
		await sql`UPDATE blocks SET parent_hash = ${"0xdeadbeef"} WHERE height = 210`.execute(
			db,
		);

		const after = await findBrokenLinks(db);
		const found = after.length > 0;
		record(
			"broken ancestry",
			"detector reports the false parent",
			found ? "pass" : "fail",
			found ? `broken link at ${after[0]?.height}` : "no broken link reported",
		);

		const gaps = await findGaps(db);
		record(
			"broken ancestry",
			"a gap check alone would have missed it",
			gaps.length === 0 ? "pass" : "fail",
			gaps.length === 0
				? "findGaps stayed silent, as expected"
				: "findGaps reported something unexpected",
		);

		const fixed = repair(url);
		record(
			"broken ancestry",
			"repair restores the parent",
			fixed.status,
			fixed.detail,
		);
	});
}

// ── drill 3: an import is torn ─────────────────────────────────────────────
async function drillPartialRestore(): Promise<void> {
	console.log("\npartial restore");
	await withDatabase("sld_torn", async (db) => {
		// `dataset` is load-bearing: the planner keys every mark by dataset, so
		// omitting it silently yields an empty set and a plan that truncates
		// nothing.
		const partitions = [
			{ dataset: "blocks", from_block: 0, to_block: 99 },
			{ dataset: "blocks", from_block: 100, to_block: 199 },
			{ dataset: "blocks", from_block: 200, to_block: 299 },
		];

		const fresh = planTornImport({
			hasIndexProgress: false,
			highWater: { blocks: null, transactions: null, events: null },
			partitions,
		});
		record(
			"partial restore",
			"an empty target plans a fresh import",
			fresh.action === "fresh" ? "pass" : "fail",
			`action=${fresh.action}`,
		);

		// Stop mid-partition: rows exist, but not to a partition boundary. This is
		// what a killed COPY leaves behind.
		await seedHealthy(db, 0, 149);

		const torn = planTornImport({
			hasIndexProgress: false,
			highWater: { blocks: 149, transactions: 149, events: 149 },
			partitions,
		});
		const resumes = torn.action === "resume";
		record(
			"partial restore",
			"a torn import plans a resume, not a fresh start",
			resumes ? "pass" : "fail",
			`action=${torn.action}${
				resumes ? ` truncateFrom=${torn.truncateFrom.blocks}` : ""
			}`,
		);

		// The partial partition must be discarded from its START (100), or
		// half-loaded rows survive as silent corruption under a "successful"
		// bootstrap. Asserted exactly: a null truncateFrom means nothing gets
		// discarded, which is the failure, not a pass.
		const discards =
			torn.action === "resume" && torn.truncateFrom.blocks === 100;
		record(
			"partial restore",
			"the half-written partition is discarded from its start",
			discards ? "pass" : "fail",
			torn.action === "resume"
				? `truncateFrom=${torn.truncateFrom.blocks} (want 100)`
				: "no resume plan",
		);

		// Everything below the tear was already sealed and must not be re-loaded.
		const skips = torn.action === "resume" && torn.skipThrough.blocks === 99;
		record(
			"partial restore",
			"sealed partitions below the tear are skipped",
			skips ? "pass" : "fail",
			torn.action === "resume"
				? `skipThrough=${torn.skipThrough.blocks} (want 99)`
				: "no resume plan",
		);

		const completed = planTornImport({
			hasIndexProgress: true,
			highWater: { blocks: 299, transactions: 299, events: 299 },
			partitions,
		});
		record(
			"partial restore",
			"a completed bootstrap refuses to re-import",
			completed.action === "refuse" ? "pass" : "fail",
			`action=${completed.action}`,
		);
	});
}

// ── drill 4: the archive itself is bad ─────────────────────────────────────
async function drillBadArchive(): Promise<void> {
	console.log("\nbad archive");
	const dir = mkdtempSync(join(tmpdir(), "sl-drill-archive-"));
	try {
		const { publicKey, privateKey } = generateKeyPairSync("ed25519");
		const privatePem = privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString();
		const publicPem = publicKey
			.export({ type: "spki", format: "pem" })
			.toString();

		const manifest = signStreamsBulkManifest(
			{
				schema_version: 1,
				network: "mainnet",
				coverage: { from_block: 0, to_block: 99 },
				range_digests: [],
				partitions: [],
			},
			privatePem,
		);

		const good = join(dir, "good.json");
		writeFileSync(good, JSON.stringify(manifest, null, 2));

		// Same signature, different claim — the tamper a naive reader would miss.
		const tampered = {
			...manifest,
			coverage: { from_block: 0, to_block: 999_999 },
		};
		const bad = join(dir, "tampered.json");
		writeFileSync(bad, JSON.stringify(tampered, null, 2));

		const unsigned = join(dir, "unsigned.json");
		writeFileSync(
			unsigned,
			JSON.stringify({ coverage: { from_block: 0, to_block: 99 } }, null, 2),
		);

		const { checkSignature } = await import(
			"../../packages/cli/src/lib/archive-reference.ts"
		);

		const goodResult = checkSignature(manifest, publicPem, false);
		record(
			"bad archive",
			"a genuine manifest verifies",
			goodResult.verified ? "pass" : "fail",
			goodResult.verified ? "signature accepted" : (goodResult.reason ?? ""),
		);

		const tamperResult = checkSignature(tampered, publicPem, false);
		record(
			"bad archive",
			"a tampered manifest is refused",
			!tamperResult.verified ? "pass" : "fail",
			!tamperResult.verified
				? "signature rejected after the coverage was edited"
				: "TAMPERED MANIFEST ACCEPTED",
		);

		const unsignedResult = checkSignature(
			{ coverage: { from_block: 0, to_block: 99 } },
			publicPem,
			false,
		);
		record(
			"bad archive",
			"an unsigned manifest is never trusted",
			!unsignedResult.verified ? "pass" : "fail",
			unsignedResult.reason ?? "rejected",
		);

		const wrongKey = generateKeyPairSync("ed25519")
			.publicKey.export({ type: "spki", format: "pem" })
			.toString();
		const wrongKeyResult = checkSignature(manifest, wrongKey, false);
		record(
			"bad archive",
			"a manifest signed by the wrong key is refused",
			!wrongKeyResult.verified ? "pass" : "fail",
			!wrongKeyResult.verified ? "signature rejected" : "WRONG KEY ACCEPTED",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	if (!JSON_OUT) console.log("corruption drills");

	await drillMissingBlock();
	await drillBrokenAncestry();
	await drillPartialRestore();
	await drillBadArchive();

	const failed = results.filter((r) => r.status === "fail");
	const skipped = results.filter((r) => r.status === "skip");

	if (JSON_OUT) {
		console.log(
			JSON.stringify(
				{
					ok: failed.length === 0,
					complete: skipped.length === 0,
					totals: {
						passed: results.filter((r) => r.status === "pass").length,
						failed: failed.length,
						skipped: skipped.length,
					},
					results,
				},
				null,
				2,
			),
		);
	} else {
		console.log(
			`\n${failed.length === 0 ? "drills passed" : "drills FAILED"} — ${
				results.filter((r) => r.status === "pass").length
			} passed, ${failed.length} failed, ${skipped.length} skipped`,
		);
		if (skipped.length > 0) {
			console.log("repair half not exercised: pass --against <manifest>");
		}
	}
	process.exit(failed.length === 0 ? 0 : 1);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
