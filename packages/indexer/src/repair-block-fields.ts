#!/usr/bin/env bun
/**
 * Fill block fields the pre-journal ingest left empty, straight from our node.
 *
 * Between 7,440,674 (first live-node block) and 8,739,025 (journal start) the
 * tx/event rows are node-shaped, but three `blocks` columns were never written:
 * `timestamp = 0` through 7,842,144 (served as 1970-01-01), `burn_block_hash`
 * NULL through 7,856,108 and `index_block_hash` NULL through 8,199,877.
 *
 * Every value comes from the stacks-node, never a third-party API:
 *   - `/v3/blocks/height/{h}` → header timestamp + consensus hash, and
 *     index_block_hash = SHA512/256(block_hash ‖ consensus_hash)
 *   - `/v3/sortitions/consensus/{ch}` → burn_block_hash for that tenure
 *
 * A height is only touched when the node's block recomputes to the stored
 * `blocks.hash` at the same height, and the tenure's burn height equals the
 * stored `burn_block_height`. Anything else is reported and skipped. Updates
 * only fill fields that are 0/NULL; a populated value is never overwritten.
 *
 * Usage:
 *   bun run packages/indexer/src/repair-block-fields.ts --from 7440674 --to 8199877
 *   bun run packages/indexer/src/repair-block-fields.ts --from 7440674 --to 8199877 --apply
 *
 * Dry-run by default: fetches and checks everything, writes nothing.
 */
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import {
	nakamotoBlockHash,
	nakamotoBlockId,
	parseNakamotoBlockHeader,
} from "@secondlayer/shared/node/nakamoto";
import type { Kysely } from "kysely";

export type StoredBlock = {
	height: number;
	hash: string;
	burn_block_height: number;
	timestamp: number;
	burn_block_hash: string | null;
	index_block_hash: string | null;
};

export type NodeBlock = {
	chainLength: number;
	blockHash: string;
	indexBlockHash: string;
	consensusHash: string;
	timestamp: number;
};

export type Sortition = { burnBlockHash: string; burnBlockHeight: number };

export type BlockFieldRepair = {
	height: number;
	hash: string;
	timestamp: number | null;
	burnBlockHash: string | null;
	indexBlockHash: string | null;
};

export type BlockFieldSkip = { height: number; reason: string };

/** ~170 blk/s against the prod node at this load (2026-11-04 run); light for
 *  the node (2.4 KB GETs). Heights per DB read/UPDATE round. */
const NODE_CONCURRENCY = 40;
const BATCH_HEIGHTS = 10_000;

const with0x = (hex: string) => (hex.startsWith("0x") ? hex : `0x${hex}`);

/** Decide what to fill for one stored row. Pure: the node reads are passed in. */
export function planBlockFieldRepair(
	stored: StoredBlock,
	node: NodeBlock,
	sortition: Sortition | null,
): BlockFieldRepair | BlockFieldSkip {
	if (node.chainLength !== stored.height) {
		return {
			height: stored.height,
			reason: `node returned chain_length ${node.chainLength}`,
		};
	}
	if (with0x(node.blockHash) !== stored.hash) {
		return {
			height: stored.height,
			reason: `node block ${with0x(node.blockHash)} != stored ${stored.hash}`,
		};
	}

	let burnBlockHash: string | null = null;
	if (stored.burn_block_hash === null) {
		if (!sortition) {
			return { height: stored.height, reason: "no sortition for tenure" };
		}
		if (sortition.burnBlockHeight !== stored.burn_block_height) {
			return {
				height: stored.height,
				reason: `sortition burn height ${sortition.burnBlockHeight} != stored ${stored.burn_block_height}`,
			};
		}
		burnBlockHash = with0x(sortition.burnBlockHash);
	}

	return {
		height: stored.height,
		hash: stored.hash,
		timestamp: stored.timestamp === 0 ? node.timestamp : null,
		burnBlockHash,
		indexBlockHash:
			stored.index_block_hash === null ? with0x(node.indexBlockHash) : null,
	};
}

export function isSkip(
	r: BlockFieldRepair | BlockFieldSkip,
): r is BlockFieldSkip {
	return "reason" in r;
}

export async function fetchNodeBlockAtHeight(
	nodeUrl: string,
	height: number,
): Promise<NodeBlock> {
	const res = await fetch(`${nodeUrl}/v3/blocks/height/${height}`);
	if (!res.ok) {
		throw new Error(`/v3/blocks/height/${height} returned ${res.status}`);
	}
	const header = parseNakamotoBlockHeader(
		new Uint8Array(await res.arrayBuffer()),
	);
	const blockHash = nakamotoBlockHash(header);
	return {
		chainLength: Number(header.chainLength),
		blockHash,
		indexBlockHash: nakamotoBlockId(blockHash, header.consensusHash),
		consensusHash: header.consensusHash,
		timestamp: Number(header.timestamp),
	};
}

export async function fetchSortition(
	nodeUrl: string,
	consensusHash: string,
): Promise<Sortition | null> {
	const res = await fetch(
		`${nodeUrl}/v3/sortitions/consensus/${consensusHash}`,
	);
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new Error(
			`/v3/sortitions/consensus/${consensusHash} returned ${res.status}`,
		);
	}
	const [row] = (await res.json()) as {
		burn_block_hash: string;
		burn_block_height: number;
	}[];
	if (!row) return null;
	return {
		burnBlockHash: row.burn_block_hash,
		burnBlockHeight: row.burn_block_height,
	};
}

/** Canonical rows in [from, to] with at least one field still empty. Integer
 *  columns are bigint in Postgres and arrive as strings, so they're coerced. */
export async function loadBrokenBlocks(
	db: Kysely<Database>,
	from: number,
	to: number,
): Promise<StoredBlock[]> {
	const rows = await db
		.selectFrom("blocks")
		.select([
			"height",
			"hash",
			"burn_block_height",
			"timestamp",
			"burn_block_hash",
			"index_block_hash",
		])
		.where("canonical", "=", true)
		.where("height", ">=", from)
		.where("height", "<=", to)
		.where((eb) =>
			eb.or([
				eb("timestamp", "=", 0),
				eb("burn_block_hash", "is", null),
				eb("index_block_hash", "is", null),
			]),
		)
		.orderBy("height", "asc")
		.execute();
	return rows.map((r) => ({
		...r,
		height: Number(r.height),
		burn_block_height: Number(r.burn_block_height),
		timestamp: Number(r.timestamp),
	}));
}

/**
 * Fill only what is still empty, and only on the row whose hash we checked.
 * Returns the number of rows changed.
 */
export async function applyBlockFieldRepairs(
	db: Kysely<Database>,
	repairs: BlockFieldRepair[],
): Promise<number> {
	if (repairs.length === 0) return 0;
	const values = sql.join(
		repairs.map(
			(r) =>
				sql`(${r.height}::int, ${r.hash}::text, ${r.timestamp}::bigint, ${r.burnBlockHash}::text, ${r.indexBlockHash}::text)`,
		),
	);
	const result = await sql`
		UPDATE blocks AS b SET
			timestamp = CASE WHEN b.timestamp = 0 AND v.ts IS NOT NULL THEN v.ts ELSE b.timestamp END,
			burn_block_hash = COALESCE(b.burn_block_hash, v.burn_hash),
			index_block_hash = COALESCE(b.index_block_hash, v.index_hash)
		FROM (VALUES ${values}) AS v(height, hash, ts, burn_hash, index_hash)
		WHERE b.height = v.height AND b.hash = v.hash AND b.canonical
	`.execute(db);
	return Number(result.numAffectedRows ?? 0);
}

async function pool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (next < items.length) {
				const item = items[next++] as T;
				await worker(item);
			}
		}),
	);
}

function parseArgs(argv: string[]) {
	let from: number | undefined;
	let to: number | undefined;
	let apply = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--from") from = Number(argv[++i]);
		else if (argv[i] === "--to") to = Number(argv[++i]);
		else if (argv[i] === "--apply") apply = true;
	}
	if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) {
		throw new Error("--from <n> and --to <n> are required");
	}
	return { from: from as number, to: to as number, apply };
}

async function main() {
	const { from, to, apply } = parseArgs(process.argv.slice(2));
	const nodeUrl = process.env.STACKS_NODE_RPC_URL?.replace(/\/+$/, "");
	if (!nodeUrl) throw new Error("STACKS_NODE_RPC_URL is required");
	const db = getSourceDb();

	if (apply) {
		const lock = await sql<{ acquired: boolean }>`
			SELECT pg_try_advisory_lock(hashtext('repair-block-fields')) AS acquired
		`.execute(db);
		if (!lock.rows[0]?.acquired) {
			throw new Error(
				"another repair-block-fields --apply is running — refusing",
			);
		}
	}

	const sortitions = new Map<string, Promise<Sortition | null>>();
	const totals = { checked: 0, timestamp: 0, burn: 0, index: 0, updated: 0 };
	const skips: BlockFieldSkip[] = [];
	const started = Date.now();

	for (let lo = from; lo <= to; lo += BATCH_HEIGHTS) {
		const hi = Math.min(lo + BATCH_HEIGHTS - 1, to);
		const broken = await loadBrokenBlocks(db, lo, hi);
		const repairs: BlockFieldRepair[] = [];

		await pool(broken, NODE_CONCURRENCY, async (stored) => {
			const node = await fetchNodeBlockAtHeight(nodeUrl, stored.height);
			let sortition: Sortition | null = null;
			if (stored.burn_block_hash === null) {
				let pending = sortitions.get(node.consensusHash);
				if (!pending) {
					pending = fetchSortition(nodeUrl, node.consensusHash);
					sortitions.set(node.consensusHash, pending);
				}
				sortition = await pending;
			}
			const plan = planBlockFieldRepair(stored, node, sortition);
			if (isSkip(plan)) skips.push(plan);
			else repairs.push(plan);
		});

		totals.checked += broken.length;
		for (const r of repairs) {
			if (r.timestamp !== null) totals.timestamp++;
			if (r.burnBlockHash !== null) totals.burn++;
			if (r.indexBlockHash !== null) totals.index++;
		}
		if (apply) totals.updated += await applyBlockFieldRepairs(db, repairs);

		const secs = (Date.now() - started) / 1000;
		console.log(
			`${lo}..${hi}  broken=${broken.length} repairs=${repairs.length} skips=${skips.length}  ${(totals.checked / secs).toFixed(0)} blk/s`,
		);
	}

	console.log("\n--- summary ---");
	console.log(`range        ${from}..${to}`);
	console.log(`checked      ${totals.checked}`);
	console.log(`timestamp    ${totals.timestamp}`);
	console.log(`burn hash    ${totals.burn}`);
	console.log(`index hash   ${totals.index}`);
	console.log(`skipped      ${skips.length}`);
	for (const s of skips.slice(0, 50)) console.log(`  ${s.height}  ${s.reason}`);
	if (apply) {
		console.log(`updated      ${totals.updated}`);
		logger.info("Repaired block fields", {
			from,
			to,
			...totals,
			skipped: skips.length,
		});
	} else {
		console.log("\n(dry-run — pass --apply to write)");
	}
	await closeDb();
}

if (import.meta.main) {
	main().catch(async (err) => {
		console.error(err);
		await closeDb();
		process.exit(1);
	});
}
