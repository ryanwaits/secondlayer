#!/usr/bin/env bun
// `migrate | backfill --to <H> | parity-decode --blocks <list|range> |
// parity-state --height <H> --ord-runes <file> --ord-balances <file> |
// repair-entries | digests --from <A> --to <B> | state-hash`.

import { bytesToHex } from "@noble/hashes/utils.js";
import { runBackfill } from "./backfill.ts";
import { parseBlock } from "./block.ts";
import { migrateToLatest } from "./db/migrate.ts";
import { loadState, openStore } from "./db/store.ts";
import { computeStateHash } from "./integrity/digest.ts";
import { diffOne, txidsWithRunestoneMarker } from "./parity/decode.ts";
import { parseJsonPreservingBigInts } from "./parity/json-bigint.ts";
import {
	buildStateDiffReport,
	normalizeOrdBalancesJson,
	normalizeOrdRunesJson,
	normalizeOurBalances,
	normalizeOurEntries,
	runeIdByName,
} from "./parity/state.ts";
import { repairEntries } from "./repair.ts";
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
	const flushInterval = process.env.FLUSH_INTERVAL
		? Number(process.env.FLUSH_INTERVAL)
		: undefined;

	const start = Date.now();
	let lastFlushHeight = -1;

	await runBackfill({
		db,
		rpc,
		toHeight,
		fetchConcurrency,
		flushInterval,
		onFlush: (stats) => {
			lastFlushHeight = stats.height;
			const elapsedS = ((Date.now() - start) / 1000).toFixed(1);
			const blocksPerSec = (
				stats.blocksInWindow /
				(stats.windowMs / 1000)
			).toFixed(2);
			const rssMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(0);
			console.log(
				`✅ flush height=${stats.height} hash=${stats.hash} blocks/s=${blocksPerSec} ` +
					`balances(+${stats.balancesUpserted}/-${stats.balancesDeleted}) ` +
					`entries=${stats.entriesUpserted} events=${stats.eventsInserted} ` +
					`flushMs=${stats.ms.toFixed(0)} rssMB=${rssMb} — ${elapsedS}s elapsed ` +
					`[fetchWaitMs=${stats.fetchWaitMs.toFixed(0)} integrityMs=${stats.integrityMs.toFixed(0)} ` +
					`decipherMs=${stats.decipherMs.toFixed(0)} applyMs=${stats.applyMs.toFixed(0)} ` +
					`commitRpcMs=${stats.commitRpcMs.toFixed(0)} commitRpcCount=${stats.commitRpcCount}]`,
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
	const concurrency = Number(process.env.PARITY_DECODE_CONCURRENCY ?? "12");

	let checked = 0;
	const mismatches: Array<{
		height: number;
		txid: string;
		ours: unknown;
		ord: unknown;
	}> = [];

	async function runPool<T>(
		items: T[],
		worker: (item: T) => Promise<void>,
	): Promise<void> {
		let next = 0;
		async function runner(): Promise<void> {
			while (next < items.length) {
				const item = items[next++] as T;
				await worker(item);
			}
		}
		await Promise.all(
			Array.from({ length: Math.min(concurrency, items.length) }, runner),
		);
	}

	for (const height of heights) {
		const hash = await rpc.getblockhash(height);
		const hex = await rpc.getblock(hash);
		const block = parseBlock(hex);
		const candidateTxids = new Set(txidsWithRunestoneMarker(block));
		const candidates = block.txs.filter((tx) => candidateTxids.has(tx.txid));

		checked += candidates.length;

		await runPool(candidates, async (tx) => {
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
		});

		console.log(
			`checked height ${height}: ${candidates.length} candidate tx(s)`,
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

async function cmdParityState(args: string[]): Promise<void> {
	const heightStr = parseFlag(args, "--height");
	const ordRunesPath = parseFlag(args, "--ord-runes");
	const ordBalancesPath = parseFlag(args, "--ord-balances");
	if (!heightStr || !ordRunesPath || !ordBalancesPath) {
		throw new Error(
			"parity-state requires --height <H> --ord-runes <file> --ord-balances <file>",
		);
	}
	const height = Number(heightStr);

	const ordRunesJson = parseJsonPreservingBigInts(
		await Bun.file(ordRunesPath).text(),
	);
	const ordBalancesJson = parseJsonPreservingBigInts(
		await Bun.file(ordBalancesPath).text(),
	);
	const ordEntries = normalizeOrdRunesJson(ordRunesJson);
	const ordBalances = normalizeOrdBalancesJson(
		ordBalancesJson,
		runeIdByName(ordEntries),
	);

	const db = openStore(requireEnv("BITCOIN_DATABASE_URL"));
	const state = await loadState(db);
	const ourEntries = normalizeOurEntries(state);
	const ourBalances = normalizeOurBalances(state);
	await db.destroy();

	const report = buildStateDiffReport(
		height,
		ourEntries,
		ordEntries,
		ourBalances,
		ordBalances,
	);

	const outDir = process.env.PARITY_REPORT_DIR ?? process.cwd();
	const outPath = `${outDir}/${height}-diff.json`;
	await Bun.write(outPath, JSON.stringify(report, null, 2));

	console.log(
		`runes ours=${report.runeCounts.ours} ord=${report.runeCounts.ord}; ` +
			`outpoints ours=${report.outpointCounts.ours} ord=${report.outpointCounts.ord}; ` +
			`entry mismatches=${report.entryMismatches.length}; ` +
			`balance mismatches=${report.balanceMismatches.length}. Report: ${outPath}`,
	);

	if (
		report.entryMismatches.length > 0 ||
		report.balanceMismatches.length > 0
	) {
		process.exitCode = 1;
	}
}

async function cmdRepairEntries(): Promise<void> {
	const db = openStore(requireEnv("BITCOIN_DATABASE_URL"));
	const rpc = bitcoinRpcClientFromEnv();

	const stats = await repairEntries(db, {
		getRawTx: (txid) => rpc.getrawtransaction(txid, false),
	});
	await db.destroy();

	console.log(
		`repair-entries: scanned=${stats.rowsScanned} noRpc=${stats.rowsRepairedNoRpc} ` +
			`viaRpc=${stats.rowsRepairedViaRpc} rpcCalls=${stats.rpcCalls} ms=${stats.ms.toFixed(0)}`,
	);
}

async function cmdDigests(args: string[]): Promise<void> {
	const fromStr = parseFlag(args, "--from");
	const toStr = parseFlag(args, "--to");
	if (!fromStr || !toStr) {
		throw new Error("digests requires --from <A> --to <B>");
	}
	const from = Number(fromStr);
	const to = Number(toStr);

	const db = openStore(requireEnv("BITCOIN_DATABASE_URL"));
	const rows = await db
		.selectFrom("rune_block_digests")
		.selectAll()
		.where("height", ">=", from)
		.where("height", "<=", to)
		.orderBy("height", "asc")
		.execute();
	await db.destroy();

	for (const row of rows) {
		console.log(
			`${row.height}\t${row.block_hash}\t${row.digest}\t${row.event_count}`,
		);
	}
}

async function cmdStateHash(): Promise<void> {
	const db = openStore(requireEnv("BITCOIN_DATABASE_URL"));
	const state = await loadState(db);
	await db.destroy();

	const hash = bytesToHex(computeStateHash(state));
	console.log(`${state.height}\t${hash}`);
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
		case "parity-state":
			return cmdParityState(args);
		case "repair-entries":
			return cmdRepairEntries();
		case "digests":
			return cmdDigests(args);
		case "state-hash":
			return cmdStateHash();
		default:
			console.error(
				"usage: cli.ts migrate | backfill --to <H> | parity-decode --blocks <list|range> | parity-state --height <H> --ord-runes <file> --ord-balances <file> | repair-entries | digests --from <A> --to <B> | state-hash",
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
