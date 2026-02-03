import { sql, type Kysely } from "kysely";
import type { Database } from "../types.ts";

export interface Gap {
  gapStart: number;
  gapEnd: number;
  size: number;
}

export async function findGaps(db: Kysely<Database>, limit?: number): Promise<Gap[]> {
  const limitClause = limit ? sql`LIMIT ${limit}` : sql``;
  const { rows } = await sql<{ gap_start: string; gap_end: string; size: string }>`
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

export async function countMissingBlocks(db: Kysely<Database>): Promise<number> {
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

export async function computeContiguousTip(db: Kysely<Database>, fromHeight: number): Promise<number> {
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
