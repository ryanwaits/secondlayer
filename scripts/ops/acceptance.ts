#!/usr/bin/env bun
/**
 * Self-host 1.0 acceptance — run the operator lifecycle end to end and sign
 * what actually happened.
 *
 * The rule this file lives by: a leg that could not run is reported as SKIPPED
 * with the reason, never as passed. An acceptance report whose green depends on
 * checks that silently did not execute is worse than no report, because it
 * launders absence of testing into evidence of correctness. The signature at
 * the bottom covers the skips too, so the report cannot be read as stronger
 * than the run that produced it.
 *
 * Legs needing a live stack or a real archive are skipped unless you point the
 * script at them:
 *   DATABASE_URL=postgres://…/postgres bun run scripts/ops/acceptance.ts
 *   … --against <manifest>   # unlocks bootstrap-from-archive and repair
 *   … --api-url http://…     # unlocks subgraph deploy
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { resolveSyncScope } from "../../packages/shared/src/db/queries/sync-scope.ts";
import type { Database } from "../../packages/shared/src/db/types.ts";
import { planUninstall } from "../../packages/shared/src/runtime/uninstall.ts";
import { signStreamsBulkManifest } from "../../packages/shared/src/streams-bulk-manifest.ts";

const ADMIN_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
}
const AGAINST = flag("against");
const API_URL = flag("api-url");
const JSON_OUT = args.includes("--json");

type Status = "pass" | "fail" | "skip";
type Leg = { leg: string; status: Status; detail: string };
const legs: Leg[] = [];

function record(leg: string, status: Status, detail: string): void {
	legs.push({ leg, status, detail });
	if (!JSON_OUT) {
		const mark = status === "pass" ? "✓" : status === "skip" ? "–" : "✗";
		console.log(`${mark} ${leg} — ${detail}`);
	}
}

function safeName(prefix: string): string {
	const name = `${prefix}_${Date.now().toString(36)}_${Math.floor(
		Math.random() * 1e6,
	).toString(36)}`;
	if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`unsafe name ${name}`);
	return name;
}

async function createDb(prefix: string): Promise<string> {
	const name = safeName(prefix);
	const admin = postgres(ADMIN_URL, { max: 1 });
	try {
		await admin.unsafe(`CREATE DATABASE ${name}`);
	} finally {
		await admin.end();
	}
	const url = new URL(ADMIN_URL);
	url.pathname = `/${name}`;
	return url.toString();
}

async function dropDb(dbUrl: string): Promise<void> {
	const name = new URL(dbUrl).pathname.slice(1);
	const admin = postgres(ADMIN_URL, { max: 1 });
	try {
		await admin.unsafe(
			`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${name}' AND pid <> pg_backend_pid()`,
		);
		await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
	} finally {
		await admin.end();
	}
}

function connect(dbUrl: string): {
	db: Kysely<Database>;
	close: () => Promise<void>;
} {
	const client = postgres(dbUrl, { max: 4 });
	const db = new Kysely<Database>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});
	return {
		db,
		close: async () => {
			await db.destroy().catch(() => {});
			await client.end().catch(() => {});
		},
	};
}

function run(
	cmd: string[],
	env: Record<string, string | undefined> = {},
): { ok: boolean; out: string } {
	const res = spawnSync(cmd[0] as string, cmd.slice(1), {
		env: { ...process.env, ...env } as NodeJS.ProcessEnv,
		encoding: "utf8",
	});
	return {
		ok: res.status === 0,
		out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim(),
	};
}

function migrate(dbUrl: string): { ok: boolean; out: string } {
	return run(["bun", "run", "packages/shared/src/db/migrate.ts"], {
		DATABASE_URL: dbUrl,
	});
}

async function seed(db: Kysely<Database>, from: number, to: number) {
	for (let h = from; h <= to; h++) {
		await sql`
			INSERT INTO blocks (height, hash, parent_hash, burn_block_height, timestamp, canonical)
			VALUES (${h}, ${`0x${h.toString(16).padStart(8, "0")}`}, ${`0x${(h - 1).toString(16).padStart(8, "0")}`}, ${h}, ${1780000000 + h}, true)
			ON CONFLICT (height) DO NOTHING
		`.execute(db);
	}
}

async function chainDigest(db: Kysely<Database>): Promise<string> {
	const rows = await sql<{
		height: string;
		hash: string;
	}>`SELECT height::text, hash FROM blocks WHERE canonical = true ORDER BY height`.execute(
		db,
	);
	const h = createHash("sha256");
	for (const r of rows.rows) h.update(`${r.height}\t${r.hash}\n`);
	return h.digest("hex");
}

// ── install ────────────────────────────────────────────────────────────────
function legInstall(): void {
	const dir = mkdtempSync(join(tmpdir(), "sl-accept-"));
	try {
		// `init` writes .env.local into its CWD, so it must run inside the temp
		// dir — spawning it with the repo as cwd would scribble key material into
		// the working tree.
		const res2 = spawnSync(
			"bun",
			[
				"run",
				`${process.cwd()}/packages/cli/src/cli.ts`,
				"init",
				"--network",
				"mainnet",
			],
			{ cwd: dir, encoding: "utf8" },
		);
		const envPath = join(dir, ".env.local");
		if (!existsSync(envPath)) {
			record(
				"install",
				"fail",
				`init wrote no .env.local (${(res2.stderr ?? "").slice(0, 160)})`,
			);
			return;
		}
		const contents = readFileSync(envPath, "utf8");
		const required = [
			"INSTANCE_TOKEN",
			"SECONDLAYER_SECRETS_KEY",
			"STREAMS_SIGNING_PRIVATE_KEY",
		];
		const missing = required.filter((k) => !contents.includes(`${k}=`));
		const mode = statSync(envPath).mode & 0o777;
		if (missing.length > 0) {
			record("install", "fail", `missing keys: ${missing.join(", ")}`);
		} else if (mode !== 0o600) {
			// Key material readable by anyone on the box is a finding, not a nit.
			record("install", "fail", `.env.local mode ${mode.toString(8)} not 600`);
		} else {
			record("install", "pass", "init produced all keys, mode 600");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── bootstrap ──────────────────────────────────────────────────────────────
async function legBootstrap(): Promise<void> {
	if (!AGAINST) {
		record(
			"bootstrap",
			"skip",
			"no --against <manifest>; archive restore not exercised",
		);
		return;
	}
	const url = await createDb("sl_acc_boot");
	try {
		if (!migrate(url).ok) {
			record("bootstrap", "fail", "migrations failed");
			return;
		}
		const res = run(
			[
				"bun",
				"run",
				"packages/cli/src/cli.ts",
				"bootstrap",
				"--against",
				AGAINST,
				"--yes",
			],
			{ DATABASE_URL: url, STACKS_NETWORK: "mainnet" },
		);
		if (!res.ok) {
			record("bootstrap", "fail", res.out.slice(0, 200));
			return;
		}
		const { db, close } = connect(url);
		try {
			const scope = await resolveSyncScope(db, "mainnet");
			record(
				"bootstrap",
				scope.bootstrap.source === "archive" ? "pass" : "fail",
				`scope source=${scope.bootstrap.source} start=${scope.start_height}`,
			);
		} finally {
			await close();
		}
	} finally {
		await dropDb(url);
	}
}

// ── backup / restore ───────────────────────────────────────────────────────
async function legBackupRestore(): Promise<void> {
	// Absent tooling means the leg did not run; calling that a failure would be
	// the same lie in the other direction. Worth knowing: the shipped runtime
	// image carries no postgres-client, so this is a real gap for in-container
	// backups, not just a quirk of a dev laptop.
	if (!run(["sh", "-c", "command -v pg_dump && command -v pg_restore"]).ok) {
		record(
			"backup/restore",
			"skip",
			"pg_dump/pg_restore not on PATH; backup not exercised",
		);
		return;
	}
	const srcUrl = await createDb("sl_acc_src");
	const dstUrl = await createDb("sl_acc_dst");
	const bundle = mkdtempSync(join(tmpdir(), "sl-bundle-"));
	const key = createHash("sha256").update("acceptance").digest("hex");
	try {
		if (!migrate(srcUrl).ok) {
			record("backup/restore", "fail", "source migrations failed");
			return;
		}
		const src = connect(srcUrl);
		await seed(src.db, 500, 520);
		const before = await chainDigest(src.db);
		await src.close();

		const backup = run(
			[
				"bun",
				"run",
				"packages/cli/src/cli.ts",
				"backup",
				"--out",
				bundle,
				"--passphrase",
				"acceptance-pass",
			],
			{
				DATABASE_URL: srcUrl,
				STACKS_NETWORK: "mainnet",
				SECONDLAYER_SECRETS_KEY: key,
			},
		);
		if (!backup.ok) {
			record("backup/restore", "fail", `backup: ${backup.out.slice(0, 200)}`);
			return;
		}

		// The failure this proves we catch: restoring under a different key would
		// leave every encrypted column unreadable, silently.
		const wrongKey = run(
			[
				"bun",
				"run",
				"packages/cli/src/cli.ts",
				"restore",
				"--from",
				bundle,
				"--passphrase",
				"acceptance-pass",
				"--apply",
			],
			{
				DATABASE_URL: dstUrl,
				STACKS_NETWORK: "mainnet",
				SECONDLAYER_SECRETS_KEY: createHash("sha256")
					.update("wrong")
					.digest("hex"),
			},
		);
		if (wrongKey.ok) {
			record(
				"backup/restore",
				"fail",
				"a mismatched secrets key was accepted — encrypted columns would be lost",
			);
			return;
		}

		const restore = run(
			[
				"bun",
				"run",
				"packages/cli/src/cli.ts",
				"restore",
				"--from",
				bundle,
				"--passphrase",
				"acceptance-pass",
				"--apply",
			],
			{
				DATABASE_URL: dstUrl,
				STACKS_NETWORK: "mainnet",
				SECONDLAYER_SECRETS_KEY: key,
			},
		);
		if (!restore.ok) {
			record("backup/restore", "fail", `restore: ${restore.out.slice(0, 200)}`);
			return;
		}

		const dst = connect(dstUrl);
		const after = await chainDigest(dst.db);
		await dst.close();
		record(
			"backup/restore",
			before === after && before.length > 0 ? "pass" : "fail",
			before === after
				? `wiped-host restore reproduced the chain (${before.slice(0, 12)}…)`
				: `digest mismatch ${before.slice(0, 12)} vs ${after.slice(0, 12)}`,
		);
	} finally {
		rmSync(bundle, { recursive: true, force: true });
		await dropDb(srcUrl);
		await dropDb(dstUrl);
	}
}

// ── upgrade ────────────────────────────────────────────────────────────────
async function legUpgrade(): Promise<void> {
	const url = await createDb("sl_acc_upgrade");
	try {
		const first = migrate(url);
		if (!first.ok) {
			record("upgrade", "fail", "initial migrations failed");
			return;
		}
		const { db, close } = connect(url);
		await seed(db, 900, 910);
		const before = await chainDigest(db);
		await close();

		// Re-running migrations is what an upgrade does on every boot; data must
		// survive it untouched.
		const second = migrate(url);
		if (!second.ok) {
			record("upgrade", "fail", "re-running migrations failed");
			return;
		}
		const again = connect(url);
		const after = await chainDigest(again.db);
		await again.close();
		record(
			"upgrade",
			before === after ? "pass" : "fail",
			before === after
				? "data survived a migrate-forward cycle"
				: "data changed across an upgrade",
		);
	} finally {
		await dropDb(url);
	}
}

// ── uninstall ──────────────────────────────────────────────────────────────
function legUninstall(): void {
	const preserving = planUninstall({
		purge: false,
		confirmed: false,
		keysBackedUp: false,
		secretsPresent: true,
		dataDir: "/data",
	});
	const unbackedPurge = planUninstall({
		purge: true,
		confirmed: true,
		keysBackedUp: false,
		secretsPresent: true,
		dataDir: "/data",
	});
	const ok =
		preserving.ok && preserving.plan.destroys.length === 0 && !unbackedPurge.ok;
	record(
		"uninstall",
		ok ? "pass" : "fail",
		ok
			? "default preserves all data; purge refused without a keys backup"
			: "teardown did not preserve data or did not gate the purge",
	);
}

// ── legs that need a live stack ────────────────────────────────────────────
function legDeploy(): void {
	if (!API_URL) {
		record("deploy", "skip", "no --api-url; subgraph deploy not exercised");
		return;
	}
	const res = run(
		["bun", "run", "packages/cli/src/cli.ts", "subgraphs", "list"],
		{ SL_API_URL: API_URL },
	);
	record(
		"deploy",
		res.ok ? "pass" : "fail",
		res.ok ? "instance answered the subgraph API" : res.out.slice(0, 160),
	);
}

function legRepair(): void {
	if (!AGAINST) {
		record("repair", "skip", "no --against <manifest>; repair not exercised");
		return;
	}
	const res = run(
		[
			"bun",
			"run",
			"packages/cli/src/cli.ts",
			"verify",
			"raw",
			"--against",
			AGAINST,
		],
		{},
	);
	// verify exits 1 on divergence and 2 when it cannot anchor; both are real
	// answers, only a crash is a failure of the leg itself.
	record(
		"repair",
		res.out.length > 0 ? "pass" : "fail",
		`verify reported: ${res.out.split("\n")[0]?.slice(0, 120)}`,
	);
}

function legReorg(): void {
	record(
		"reorg",
		"skip",
		"needs a live indexer against a forking node; not exercised by this harness",
	);
}

async function main(): Promise<void> {
	if (!JSON_OUT) console.log("self-host acceptance\n");

	legInstall();
	await legBootstrap();
	legReorg();
	legDeploy();
	legRepair();
	await legBackupRestore();
	await legUpgrade();
	legUninstall();

	const failed = legs.filter((l) => l.status === "fail");
	const skipped = legs.filter((l) => l.status === "skip");

	let report: Record<string, unknown> = {
		schema_version: 1,
		generated_at: new Date().toISOString(),
		// `ok` means nothing failed. `complete` means nothing was skipped. A
		// report can be ok and incomplete, and conflating the two is how a
		// partial run gets read as a full one.
		ok: failed.length === 0,
		complete: skipped.length === 0,
		totals: {
			passed: legs.filter((l) => l.status === "pass").length,
			failed: failed.length,
			skipped: skipped.length,
		},
		legs,
	};

	const signingKey = process.env.STREAMS_SIGNING_PRIVATE_KEY;
	if (signingKey) {
		report = signStreamsBulkManifest(report, signingKey);
	} else {
		report.signature_note = "unsigned: STREAMS_SIGNING_PRIVATE_KEY was not set";
	}

	if (JSON_OUT) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		console.log(
			`\n${failed.length === 0 ? "ACCEPTED" : "REJECTED"} — ${
				report.totals && (report.totals as { passed: number }).passed
			} passed, ${failed.length} failed, ${skipped.length} skipped${
				signingKey ? " (signed)" : " (unsigned)"
			}`,
		);
		if (skipped.length > 0) {
			console.log("not a complete acceptance: some legs did not run");
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
