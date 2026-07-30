import { type Kysely, sql } from "kysely";
import type { Database } from "../types.ts";

export interface Gap {
	gapStart: number;
	gapEnd: number;
	size: number;
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
	opts: { window?: number; limit?: number } = {},
): Promise<BrokenLink[]> {
	const windowSize = opts.window ?? 10_000;
	const limitClause = opts.limit ? sql`LIMIT ${opts.limit}` : sql``;
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
				AND height > (SELECT MAX(height) - ${windowSize} FROM blocks WHERE canonical = true)
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
