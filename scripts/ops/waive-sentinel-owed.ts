#!/usr/bin/env bun
/**
 * Waive owed Sentinel usage — one-off for the day Sentinel's billing moves to
 * its own Stripe subscriptions.
 *
 * While Sentinel metered through this ledger, a `sentinel.*` charge that found
 * the balance short was kept as `debited = false` ("owed") and collected later
 * by `/internal/sentinel/accounts/settle`. That route and every `sentinel.*`
 * unit are gone, so nothing will ever collect those rows. This script waives
 * them: `usd_micros` becomes 0 and `source` becomes `sentinel:waived`, so the
 * account usage view stops showing them as unpaid. `quantity` and the
 * `idempotency_key` are untouched. Starter grants already credited to a
 * balance are not touched; they stay as Secondlayer credit.
 *
 * Idempotent: a waived row has `source = 'sentinel:waived'` and is skipped.
 *
 * Usage:
 *   bun scripts/ops/waive-sentinel-owed.ts                          dry run: counts only, writes nothing
 *   bun scripts/ops/waive-sentinel-owed.ts --apply --backup <file>  waive; <file> receives the original rows (JSON, must not exist)
 *   --account <uuid>                                                 limit either mode to one account
 *
 * Env: TARGET_DATABASE_URL or DATABASE_URL (required). The dry run prints the
 * database host and name first; check it before you pass `--apply`.
 *
 * Run it once, after Sentinel's own billing cutover has deployed and the
 * `/internal/meters` retirement of `sentinel.*` units is live, so no new owed
 * rows can appear.
 */

import { existsSync, writeFileSync } from "node:fs";
import { closeDb, getDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { type Kysely, sql } from "kysely";

export const SENTINEL_UNIT_PREFIX = "sentinel.";
export const WAIVED_SOURCE = "sentinel:waived";

export type Args = {
	apply: boolean;
	backup: string | null;
	account: string | null;
};

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv: string[]): Args {
	const out: Args = { apply: false, backup: null, account: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--apply") out.apply = true;
		else if (a === "--backup" || a === "--account") {
			const v = argv[++i];
			if (!v || v.startsWith("--")) throw new Error(`${a} needs a value`);
			if (a === "--backup") out.backup = v;
			else if (!UUID_RE.test(v)) throw new Error("--account must be a uuid");
			else out.account = v;
		} else throw new Error(`unknown argument: ${a}`);
	}
	if (out.apply && !out.backup) {
		throw new Error("--apply requires --backup <file> for the original rows");
	}
	if (!out.apply && out.backup) {
		throw new Error("--backup only makes sense with --apply");
	}
	return out;
}

export type OwedRow = {
	id: string;
	account_id: string;
	unit: string;
	quantity: string;
	usd_micros: string;
	source: string;
	idempotency_key: string;
	occurred_at: Date;
};

export type Summary = {
	rows: number;
	accounts: number;
	usdMicros: bigint;
	byUnit: { unit: string; rows: number; usdMicros: bigint }[];
};

export function summarize(rows: OwedRow[]): Summary {
	const units = new Map<string, { rows: number; usdMicros: bigint }>();
	const accounts = new Set<string>();
	let total = 0n;
	for (const r of rows) {
		accounts.add(r.account_id);
		const usd = BigInt(r.usd_micros);
		total += usd;
		const u = units.get(r.unit) ?? { rows: 0, usdMicros: 0n };
		u.rows += 1;
		u.usdMicros += usd;
		units.set(r.unit, u);
	}
	return {
		rows: rows.length,
		accounts: accounts.size,
		usdMicros: total,
		byUnit: [...units.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([unit, v]) => ({ unit, ...v })),
	};
}

/** Undebited, not-yet-waived `sentinel.*` ledger rows. */
export async function selectOwed(
	db: Kysely<Database>,
	account: string | null = null,
): Promise<OwedRow[]> {
	let q = db
		.selectFrom("usage_ledger")
		.select([
			"id",
			"account_id",
			"unit",
			"quantity",
			"usd_micros",
			"source",
			"idempotency_key",
			"occurred_at",
		])
		.where("debited", "=", false)
		.where("source", "<>", WAIVED_SOURCE)
		.where(sql<boolean>`unit LIKE ${`${SENTINEL_UNIT_PREFIX}%`}`);
	if (account) q = q.where("account_id", "=", account);
	const rows = await q.orderBy("occurred_at").orderBy("id").execute();
	return rows.map((r) => ({
		...r,
		quantity: String(r.quantity),
		usd_micros: String(r.usd_micros),
	}));
}

/**
 * Waive every owed row in one transaction. The rows are re-selected inside it
 * (`FOR UPDATE`) and the same set is updated, so `backup` always lists exactly
 * what changed. Returns what was waived.
 */
export async function waiveOwed(
	db: Kysely<Database>,
	opts: { account?: string | null; onRows?: (rows: OwedRow[]) => void } = {},
): Promise<Summary> {
	return db.transaction().execute(async (trx) => {
		let lock = trx
			.selectFrom("usage_ledger")
			.select("id")
			.where("debited", "=", false)
			.where("source", "<>", WAIVED_SOURCE)
			.where(sql<boolean>`unit LIKE ${`${SENTINEL_UNIT_PREFIX}%`}`);
		if (opts.account) lock = lock.where("account_id", "=", opts.account);
		await lock.forUpdate().execute();

		const rows = await selectOwed(trx, opts.account ?? null);
		// Write the backup before the update; a throw rolls the transaction back.
		opts.onRows?.(rows);
		if (rows.length > 0) {
			await trx
				.updateTable("usage_ledger")
				.set({ usd_micros: "0", source: WAIVED_SOURCE })
				.where(
					"id",
					"in",
					rows.map((r) => r.id),
				)
				.execute();
		}
		return summarize(rows);
	});
}

function formatSummary(s: Summary): string {
	const usd = (m: bigint) => `$${(Number(m) / 1_000_000).toFixed(6)}`;
	const lines = [
		`rows:     ${s.rows}`,
		`accounts: ${s.accounts}`,
		`owed:     ${usd(s.usdMicros)} (${s.usdMicros} micros)`,
	];
	for (const u of s.byUnit) {
		lines.push(`  ${u.unit}: ${u.rows} rows, ${usd(u.usdMicros)}`);
	}
	return lines.join("\n");
}

function describeTarget(): string {
	const raw = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;
	if (!raw) throw new Error("no db: set TARGET_DATABASE_URL or DATABASE_URL");
	const url = new URL(raw);
	return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

async function main() {
	let args: Args;
	try {
		args = parseArgs(process.argv.slice(2));
		console.log(`database: ${describeTarget()}`);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(2);
	}
	if (args.apply && args.backup && existsSync(args.backup)) {
		console.error(`${args.backup} already exists; refusing to overwrite`);
		process.exit(2);
	}
	const db = getDb();
	try {
		if (!args.apply) {
			const s = summarize(await selectOwed(db, args.account));
			console.log(`dry run, nothing written\n${formatSummary(s)}`);
			return;
		}
		const s = await waiveOwed(db, {
			account: args.account,
			onRows: (rows) => {
				if (args.backup) {
					writeFileSync(args.backup, JSON.stringify(rows, null, 2), {
						flag: "wx",
					});
				}
			},
		});
		console.log(`waived\n${formatSummary(s)}\nbackup: ${args.backup}`);
	} finally {
		await closeDb();
	}
}

if (import.meta.main) await main();
