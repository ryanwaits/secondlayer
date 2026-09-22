#!/usr/bin/env bun
// `migrate | backfill --to <H> | parity-decode --blocks <list|range>`.
//
// NOT implemented: `parity-state --height <H> --ord-runes <file> --ord-balances
// <file>` (plan design's fourth subcommand). It diffs our state against ord's
// `runes`/`balances` CLI output at a frozen height (step 7) — this run only
// ran the backfill itself and explicitly skipped the ord freeze/compare part
// of step 7 (ord was still syncing, nowhere near 841,000). Building it
// against no real ord output to verify against would be unverified code
// pretending to be done; the reviewer should add it against a real frozen
// height. `parity/decode.ts`'s `normalizeOrdDecode`/`json-bigint.ts` are
// already shaped to be reused for it directly.

import { runBackfill } from "./backfill.ts";
import { parseBlock } from "./block.ts";
import { migrateToLatest } from "./db/migrate.ts";
import { openStore } from "./db/store.ts";
import { diffOne, txidsWithRunestoneMarker } from "./parity/decode.ts";
import { bitcoinRpcClientFromEnv } from "./rpc.ts";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`missing required env var ${name}`);
	return value;
}

function parseFlag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	if (i === -1) return undefined;
	const value = args[i + 1];
	if (value === undefined) throw new Error(`${name} requires a value`);
	return value;
}

/** `"840000,840001"` (list) or `"850000-960000"` / `"850000-960000:10000"` (range, optional step). */
function parseBlockSpec(spec: string): number[] {
	const heights = new Set<number>();
	for (const part of spec.split(",")) {
		const trimmed = part.trim();
		const rangeMatch = trimmed.match(/^(\d+)-(\d+)(?::(\d+))?$/);
		if (rangeMatch) {
			const from = Number(rangeMatch[1]);
			const to = Number(rangeMatch[2]);
			const step = rangeMatch[3] ? Number(rangeMatch[3]) : 1;
			for (let h = from; h <= to; h += step) heights.add(h);
			continue;
		}
		if (/^\d+$/.test(trimmed)) {
			heights.add(Number(trimmed));
			continue;
		}
		throw new Error(`invalid block spec segment: "${trimmed}"`);
	}
	return [...heights].sort((a, b) => a - b);
}

async function cmdMigrate(): Promise<void> {
	await migrateToLatest();
}

async function cmdBackfill(args: string[]): Promise<void> {
	const toStr = parseFlag(args, "--to");
	if (!toStr) throw new Error("backfill requires --to <height>");
	const toHeight = Number(toStr);

	const db = openStore(requireEnv("BITCOIN_DATABASE_URL"));
	const rpc = bitcoinRpcClientFromEnv();
	const fetchConcurrency = Number(process.env.FETCH_CONCURRENCY ?? "8");

	const start = Date.now();
	let lastFlushHeight = -1;

	await runBackfill({
		db,
		rpc,
		toHeight,
		fetchConcurrency,
		onFlush: (info) => {
			lastFlushHeight = info.height;
			const elapsedS = ((Date.now() - start) / 1000).toFixed(1);
			console.log(
				`✅ flushed through height ${info.height} (hash ${info.hash}) — ${elapsedS}s elapsed`,
			);
		},
	});

	const totalS = ((Date.now() - start) / 1000).toFixed(1);
	console.log(
		`backfill to ${toHeight} complete (last flush ${lastFlushHeight}) in ${totalS}s`,
	);
	await db.destroy();
}

async function cmdParityDecode(args: string[]): Promise<void> {
	const blocksSpec = parseFlag(args, "--blocks");
	if (!blocksSpec)
		throw new Error("parity-decode requires --blocks <list|range>");
	const ordUrl = process.env.ORD_URL ?? "http://127.0.0.1:8089";

	const heights = parseBlockSpec(blocksSpec);
	const rpc = bitcoinRpcClientFromEnv();

	let checked = 0;
	const mismatches: Array<{
		height: number;
		txid: string;
		ours: unknown;
		ord: unknown;
	}> = [];

	for (const height of heights) {
		const hash = await rpc.getblockhash(height);
		const hex = await rpc.getblock(hash);
		const block = parseBlock(hex);
		const candidateTxids = new Set(txidsWithRunestoneMarker(block));

		for (const tx of block.txs) {
			if (!candidateTxids.has(tx.txid)) continue;
			checked += 1;
			const mismatch = await diffOne(tx, ordUrl);
			if (mismatch) {
				mismatches.push({
					height,
					txid: mismatch.txid,
					ours: mismatch.ours,
					ord: mismatch.ord,
				});
				console.error(`❌ mismatch at height ${height}, tx ${mismatch.txid}`);
			}
		}
		console.log(
			`checked height ${height}: ${candidateTxids.size} candidate tx(s)`,
		);
	}

	const report = {
		date: new Date().toISOString(),
		blocksChecked: heights.length,
		txsChecked: checked,
		mismatchCount: mismatches.length,
		mismatches,
	};

	const outDir = process.env.PARITY_REPORT_DIR ?? process.cwd();
	const outPath = `${outDir}/decode-${new Date().toISOString().slice(0, 10)}.json`;
	await Bun.write(
		outPath,
		JSON.stringify(
			report,
			(_key, value) => (typeof value === "bigint" ? value.toString() : value),
			2,
		),
	);

	console.log(
		`\n${checked} tx(s) checked, ${mismatches.length} mismatch(es). Report: ${outPath}`,
	);
	if (mismatches.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);

	switch (command) {
		case "migrate":
			return cmdMigrate();
		case "backfill":
			return cmdBackfill(args);
		case "parity-decode":
			return cmdParityDecode(args);
		default:
			console.error(
				"usage: cli.ts migrate | backfill --to <H> | parity-decode --blocks <list|range>",
			);
			process.exit(1);
	}
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
