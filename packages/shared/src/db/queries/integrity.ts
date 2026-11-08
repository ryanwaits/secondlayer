import { type Kysely, sql } from "kysely";
import type { Database } from "../types.ts";
import { stacksNetworkFromEnv } from "./instance.ts";
import { getSyncScope, upsertSyncScope } from "./sync-scope.ts";

export interface Gap {
	gapStart: number;
	gapEnd: number;
	size: number;
}

/**
 * The three honest answers to "what is the chain tip", so no reader derives its
 * own:
 *
 *   seen        highest block height the indexer has received (`index_progress`)
 *   canonical   highest block currently canonical in `blocks`
 *   contiguous  highest height with no gap below it (`index_progress`)
 *
 * `null` when nothing is recorded yet. The node's own tip is a different
 * question (it needs RPC) and is not answered here.
 */
export type ChainTipKind = "seen" | "canonical" | "contiguous";

export async function resolveChainTip(
	db: Kysely<Database>,
	kind: ChainTipKind,
	opts: { network?: string } = {},
): Promise<number | null> {
	if (kind === "canonical") {
		const row = await db
			.selectFrom("blocks")
			.select("height")
			.where("canonical", "=", true)
			.orderBy("height", "desc")
			.limit(1)
			.executeTakeFirst();
		return row ? Number(row.height) : null;
	}
	const column =
		kind === "seen" ? "highest_seen_block" : "last_contiguous_block";
	const row = await db
		.selectFrom("index_progress")
		.select(column)
		.where("network", "=", opts.network ?? stacksNetworkFromEnv())
		.executeTakeFirst();
	return row ? Number(row[column]) : null;
}

export async function findGaps(
	db: Kysely<Database>,
	limit?: number,
): Promise<Gap[]> {
	const limitClause = limit ? sql`LIMIT ${limit}` : sql``;
	const { rows } = await sql<{
		gap_start: string;
		gap_end: string;
		size: string;
	}>`
    SELECT gap_start, gap_end, gap_end - gap_start + 1 AS size
    FROM (
      SELECT height + 1 AS gap_start, next_height - 1 AS gap_end
      FROM (
        SELECT height, LEAD(height) OVER (ORDER BY height) AS next_height
        FROM blocks WHERE canonical = true
      ) sub
      WHERE next_height - height > 1
    ) gaps
    ORDER BY gap_start
    ${limitClause}
  `.execute(db);

	return rows.map((r) => ({
		gapStart: Number(r.gap_start),
		gapEnd: Number(r.gap_end),
		size: Number(r.size),
	}));
}

export async function countMissingBlocks(
	db: Kysely<Database>,
): Promise<number> {
	const { rows } = await sql<{ total: string }>`
    SELECT COALESCE(SUM(next_height - height - 1), 0) AS total
    FROM (
      SELECT height, LEAD(height) OVER (ORDER BY height) AS next_height
      FROM blocks WHERE canonical = true
    ) sub
    WHERE next_height - height > 1
  `.execute(db);

	return Number(rows[0]?.total ?? 0);
}

export interface ChainDataIntegrity {
	ok: boolean;
	maxHeight: number;
	sampleHeight: number | null;
	sampleBlocks: number;
	reason: string | null;
}

/**
 * Cheap sanity check that the `blocks` table actually holds the history its tip
 * implies. Catches a wrong/empty Postgres volume — e.g. a container recreated
 * against a fresh volume — being silently served: if the tip is high but a
 * window of blocks well below it is missing, the data isn't what the tip claims.
 *
 * Below `checkFloor` we can't distinguish a fresh install from an empty volume,
 * so we report ok — a genuinely new DB legitimately has little history. Two
 * indexed lookups, safe to run on every startup / health poll.
 */
export async function checkChainDataIntegrity(
	db: Kysely<Database>,
	opts?: { checkFloor?: number; lookback?: number },
): Promise<ChainDataIntegrity> {
	const checkFloor = opts?.checkFloor ?? 1_000_000;
	const lookback = opts?.lookback ?? 500_000;

	const { rows: tipRows } = await sql<{ max: string | null }>`
		SELECT MAX(height) AS max FROM blocks WHERE canonical = true
	`.execute(db);
	const maxHeight = Number(tipRows[0]?.max ?? 0);

	if (maxHeight < checkFloor) {
		return {
			ok: true,
			maxHeight,
			sampleHeight: null,
			sampleBlocks: 0,
			reason: null,
		};
	}

	const sampleHeight = maxHeight - lookback;
	const { rows: sampleRows } = await sql<{ n: string }>`
		SELECT count(*) AS n FROM blocks
		WHERE canonical = true AND height >= ${sampleHeight} AND height < ${sampleHeight + 1000}
	`.execute(db);
	const sampleBlocks = Number(sampleRows[0]?.n ?? 0);

	return {
		ok: sampleBlocks > 0,
		maxHeight,
		sampleHeight,
		sampleBlocks,
		reason:
			sampleBlocks > 0
				? null
				: `tip is ${maxHeight} but no canonical blocks near ${sampleHeight} — wrong or empty volume?`,
	};
}

async function lowestCanonicalHeight(
	db: Kysely<Database>,
	above: number,
): Promise<number | null> {
	const { rows } = await sql<{ min: string | null }>`
		SELECT MIN(height) AS min FROM blocks
		WHERE canonical = true AND height > ${above}
	`.execute(db);
	const min = rows[0]?.min;
	return min === null || min === undefined ? null : Number(min);
}

/**
 * The height contiguity is measured from: where this instance's canonical
 * history begins, never an assumed 1. A recorded sync scope above the lowest
 * stored block wins (an operator or the indexer declared that history below it
 * is deliberately absent); otherwise it is the lowest canonical block.
 *
 * `null` when no canonical block is stored yet.
 */
export async function resolveContiguousFloor(
	db: Kysely<Database>,
	network: string = stacksNetworkFromEnv(),
): Promise<number | null> {
	const lowest = await lowestCanonicalHeight(db, -1);
	if (lowest === null) return null;
	const scope = await getSyncScope(db, network);
	return Math.max(lowest, scope?.start_height ?? 0);
}

/**
 * First block above genesis lands on an instance whose cursor is still 0.
 *
 * A node on a cached chain (a Clarinet devnet) announces its genesis block at
 * boot and then first shows the chain at its real height; the heights between
 * are never delivered. Counting from that lone genesis row leaves the cursor
 * pinned below a hole nobody can fill, so declare the lowest block above
 * genesis as the instance's start (the same declaration a forward-only archive
 * restore makes) and return the floor contiguity now counts from. A scope that
 * already exists is never overwritten.
 */
export async function seedContiguousFloor(
	db: Kysely<Database>,
	network: string,
): Promise<number | null> {
	const lowest = await lowestCanonicalHeight(db, -1);
	const aboveGenesis = await lowestCanonicalHeight(db, 0);
	if (
		lowest === 0 &&
		aboveGenesis !== null &&
		aboveGenesis > 1 &&
		(await getSyncScope(db, network)) === null
	) {
		await upsertSyncScope(db, {
			network,
			start_height: aboveGenesis,
			target_height: null,
			bootstrap: {
				source: "import",
				manifest_digest: null,
				genesis_hash: null,
			},
		});
	}
	return resolveContiguousFloor(db, network);
}

export async function computeContiguousTip(
	db: Kysely<Database>,
	fromHeight: number,
): Promise<number> {
	const { rows } = await sql<{ tip: string }>`
    SELECT COALESCE(MAX(height), ${fromHeight}) AS tip
    FROM (
      SELECT height, height - ROW_NUMBER() OVER (ORDER BY height) AS grp
      FROM blocks WHERE canonical = true AND height >= ${fromHeight}
    ) sub
    WHERE grp = (
      SELECT height - ROW_NUMBER() OVER (ORDER BY height)
      FROM blocks WHERE canonical = true AND height = ${fromHeight}
    )
  `.execute(db);

	return Number(rows[0]?.tip ?? fromHeight);
}

export type ShortBlock = {
	height: number;
	expectedTxCount: number;
	actualTxCount: number;
};

/**
 * Canonical heights where `transactions` holds fewer (or more) rows than the
 * block was supposed to. `blocks.tx_count` is set by `persistBlock` from the
 * incoming block, so a mismatch means a later write silently moved or dropped
 * a tx after that block was persisted — a reorg replaying the wrong height, a
 * same-height tx_id collision, or a bug in the persist path itself. Ingest
 * used to report the *parsed* count, not the inserted count, so this kind of
 * short block was invisible; a skipped insert looked identical to success.
 *
 * Scoped to heights with `tx_count IS NOT NULL` — rows ingested before this
 * column existed have no baseline to check against. Also scoped to a recent
 * window by default (like `findBrokenLinks`): every new block sets
 * `tx_count`, so the eligible range only grows, and a short block is an
 * active-repair concern, not something worth a full-table scan every cycle.
 */
export async function findShortBlocks(
	db: Kysely<Database>,
	/** Heights below the tip to scan; `null` scans the whole chain. */
	opts: { window?: number | null; limit?: number } = {},
): Promise<ShortBlock[]> {
	const windowSize = opts.window === undefined ? 10_000 : opts.window;
	const limitClause = opts.limit ? sql`LIMIT ${opts.limit}` : sql``;
	const windowClause =
		windowSize === null
			? sql``
			: sql`AND b.height > (SELECT MAX(height) - ${windowSize} FROM blocks WHERE canonical = true)`;
	const { rows } = await sql<{
		height: string | number;
		tx_count: number;
		actual_count: string | number;
	}>`
		SELECT b.height, b.tx_count, COUNT(t.tx_id) AS actual_count
		  FROM blocks b
		  LEFT JOIN transactions t ON t.block_height = b.height
		 WHERE b.canonical = true
		   AND b.tx_count IS NOT NULL
		   ${windowClause}
		 GROUP BY b.height, b.tx_count
		HAVING COUNT(t.tx_id) <> b.tx_count
		 ORDER BY b.height
		 ${limitClause}
	`.execute(db);

	return rows.map((r) => ({
		height: Number(r.height),
		expectedTxCount: Number(r.tx_count),
		actualTxCount: Number(r.actual_count),
	}));
}

function recentWindow(
	windowSize: number | null,
	column: ReturnType<typeof sql.ref>,
) {
	return windowSize === null
		? sql``
		: sql`AND ${column} > (SELECT MAX(height) - ${windowSize} FROM blocks WHERE canonical = true)`;
}

export type DuplicateTxIndex = {
	height: number;
	txIndex: number;
	count: number;
};

/**
 * `(block_height, tx_index)` pairs held by more than one transaction on a
 * canonical block. A transaction's index is its position in the block, so each
 * pair is unique; two rows sharing one make Streams and Index order that block
 * ambiguously. Windowed by default; the daily canonical audit passes its own
 * window.
 */
export async function findDuplicateTxIndexes(
	db: Kysely<Database>,
	opts: {
		window?: number | null;
		/** Absolute lower bound: only heights above it. */
		floorHeight?: number;
		limit?: number;
	} = {},
): Promise<DuplicateTxIndex[]> {
	const windowSize = opts.window === undefined ? 10_000 : opts.window;
	const limitClause = opts.limit ? sql`LIMIT ${opts.limit}` : sql``;
	const floorClause =
		opts.floorHeight === undefined
			? sql``
			: sql`AND t.block_height > ${opts.floorHeight}`;
	const { rows } = await sql<{
		block_height: string | number;
		tx_index: string | number;
		n: string | number;
	}>`
		SELECT t.block_height, t.tx_index, COUNT(*) AS n
		  FROM transactions t
		  JOIN blocks b ON b.height = t.block_height AND b.canonical = true
		 WHERE true
		   ${recentWindow(windowSize, sql.ref("t.block_height"))}
		   ${floorClause}
		 GROUP BY t.block_height, t.tx_index
		HAVING COUNT(*) > 1
		 ORDER BY t.block_height, t.tx_index
		 ${limitClause}
	`.execute(db);
	return rows.map((r) => ({
		height: Number(r.block_height),
		txIndex: Number(r.tx_index),
		count: Number(r.n),
	}));
}

export type BurnHeightRegression = {
	height: number;
	burnBlockHeight: number;
	previousBurnBlockHeight: number;
};

/**
 * Canonical blocks whose `burn_block_height` is lower than the canonical block
 * below them. Stacks blocks are anchored to Bitcoin blocks in order, so the
 * burn height never decreases as the Stacks height rises; a regression means
 * a block from another fork, or a wrongly stored anchor, sits on the chain.
 */
export async function findBurnHeightRegressions(
	db: Kysely<Database>,
	opts: { window?: number | null; limit?: number } = {},
): Promise<BurnHeightRegression[]> {
	const windowSize = opts.window === undefined ? 10_000 : opts.window;
	const limitClause = opts.limit ? sql`LIMIT ${opts.limit}` : sql``;
	const { rows } = await sql<{
		height: string | number;
		burn_block_height: string | number;
		previous: string | number;
	}>`
		SELECT height, burn_block_height, previous
		  FROM (
			SELECT height, burn_block_height,
			       LAG(burn_block_height) OVER (ORDER BY height) AS previous
			  FROM blocks
			 WHERE canonical = true
			   ${recentWindow(windowSize, sql.ref("height"))}
		  ) s
		 WHERE burn_block_height < previous
		 ORDER BY height
		 ${limitClause}
	`.execute(db);
	return rows.map((r) => ({
		height: Number(r.height),
		burnBlockHeight: Number(r.burn_block_height),
		previousBurnBlockHeight: Number(r.previous),
	}));
}

export type EventCountMismatch = {
	height: number;
	expectedEventCount: number;
	actualEventCount: number;
};

/**
 * Canonical blocks whose `events` rows disagree with the `event_count`
 * `persistBlock` recorded, the events counterpart of `findShortBlocks`.
 * Heights without a recorded count (written before the column existed) have no
 * baseline and are skipped.
 */
export async function findEventCountMismatches(
	db: Kysely<Database>,
	opts: { window?: number | null; limit?: number } = {},
): Promise<EventCountMismatch[]> {
	const windowSize = opts.window === undefined ? 10_000 : opts.window;
	const limitClause = opts.limit ? sql`LIMIT ${opts.limit}` : sql``;
	const { rows } = await sql<{
		height: string | number;
		event_count: number;
		actual: string | number;
	}>`
		SELECT b.height, b.event_count, COUNT(e.block_height) AS actual
		  FROM blocks b
		  LEFT JOIN events e ON e.block_height = b.height
		 WHERE b.canonical = true
		   AND b.event_count IS NOT NULL
		   ${recentWindow(windowSize, sql.ref("b.height"))}
		 GROUP BY b.height, b.event_count
		HAVING COUNT(e.block_height) <> b.event_count
		 ORDER BY b.height
		 ${limitClause}
	`.execute(db);
	return rows.map((r) => ({
		height: Number(r.height),
		expectedEventCount: Number(r.event_count),
		actualEventCount: Number(r.actual),
	}));
}

export type EventsLogicalIndexState = "valid" | "invalid" | "missing";

/**
 * Whether `events_logical_id_uniq` (migration 0101) protects the table.
 * The migration skips it on a large table, so a database can run without it
 * and the persist path's bare `ON CONFLICT DO NOTHING` then dedupes nothing.
 */
export async function eventsLogicalIndexState(
	db: Kysely<Database>,
): Promise<EventsLogicalIndexState> {
	const { rows } = await sql<{ indisvalid: boolean }>`
		SELECT i.indisvalid
		  FROM pg_index i
		  JOIN pg_class c ON c.oid = i.indexrelid
		 WHERE c.relname = 'events_logical_id_uniq'
		   AND i.indisunique
	`.execute(db);
	if (rows.length === 0) return "missing";
	return rows.every((r) => r.indisvalid) ? "valid" : "invalid";
}

export type BrokenLink = {
	height: number;
	hash: string;
	expectedParent: string;
	storedParent: string;
};

/**
 * Canonical heights whose block does not descend from the canonical block
 * below it.
 *
 * `findGaps` asks "is every height present?", which a chain sitting on a losing
 * fork answers yes to. On 2026-07-30 a reorg at 8,663,166 was resolved the
 * wrong way: we adopted a block that mainnet orphaned, its true successors were
 * swept non-canonical, and later blocks were inserted canonical on top. Every
 * height existed. Nothing was "missing". The chain simply did not join up, and
 * no check asked that question — so we served a broken chain for seventeen
 * hours and only noticed because subgraphs stopped moving.
 *
 * Scoped to a recent window by default: an unlinked height is an active-repair
 * concern, and scanning eight million rows every cycle is not.
 */
export async function findBrokenLinks(
	db: Kysely<Database>,
	/** Heights below the tip to scan; `null` scans the whole chain. */
	opts: { window?: number | null; limit?: number } = {},
): Promise<BrokenLink[]> {
	const windowSize = opts.window === undefined ? 10_000 : opts.window;
	const limitClause = opts.limit ? sql`LIMIT ${opts.limit}` : sql``;
	const windowClause =
		windowSize === null
			? sql``
			: sql`AND height > (SELECT MAX(height) - ${windowSize} FROM blocks WHERE canonical = true)`;
	const { rows } = await sql<{
		height: string | number;
		hash: string;
		expected_parent: string;
		stored_parent: string;
	}>`
		WITH recent AS (
			SELECT height, hash, parent_hash
			FROM blocks
			WHERE canonical = true
				${windowClause}
		)
		SELECT b.height, b.hash, p.hash AS expected_parent, b.parent_hash AS stored_parent
		FROM recent b
		JOIN recent p ON p.height = b.height - 1
		WHERE b.parent_hash <> p.hash
		ORDER BY b.height
		${limitClause}
	`.execute(db);
	return rows.map((r) => ({
		height: Number(r.height),
		hash: r.hash,
		expectedParent: r.expected_parent,
		storedParent: r.stored_parent,
	}));
}
