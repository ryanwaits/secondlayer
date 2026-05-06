import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely } from "kysely";

export type NetworkHealthDay = {
	date: string;
	block_count: number;
	avg_block_time_seconds: number | null;
	reorg_count: number;
};

export type NetworkHealthSummary = {
	days: NetworkHealthDay[];
	tip: { block_height: number } | null;
};

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

function parseDaysParam(raw: string | null): number {
	if (raw === null) return DEFAULT_DAYS;
	if (!/^[1-9]\d*$/.test(raw)) {
		throw new ValidationError("days must be a positive integer");
	}
	const parsed = Number(raw);
	if (parsed > MAX_DAYS) {
		throw new ValidationError(`days must be <= ${MAX_DAYS}`);
	}
	return parsed;
}

export type ReadNetworkHealthParams = {
	days: number;
	db?: Kysely<Database>;
};

export async function readNetworkHealth(
	params: ReadNetworkHealthParams,
): Promise<NetworkHealthDay[]> {
	const db = params.db ?? getSourceDb();
	const sinceSeconds = Math.floor(Date.now() / 1000) - params.days * 86_400;

	const { rows } = await sql<{
		date: string;
		block_count: string | number;
		avg_block_time_seconds: string | number | null;
	}>`
		WITH ordered_blocks AS (
			SELECT
				height,
				timestamp AS ts,
				timestamp - lag(timestamp) OVER (ORDER BY height) AS gap_seconds
			FROM blocks
			WHERE canonical = true
				AND timestamp >= ${sinceSeconds}
		)
		SELECT
			to_char(to_timestamp(ts), 'YYYY-MM-DD') AS date,
			COUNT(*)::bigint AS block_count,
			AVG(gap_seconds)::numeric AS avg_block_time_seconds
		FROM ordered_blocks
		GROUP BY 1
		ORDER BY date DESC
	`.execute(db);

	const blockMap = new Map(
		rows.map((row) => [
			row.date,
			{
				blockCount: Number(row.block_count),
				avgBlockTime:
					row.avg_block_time_seconds === null
						? null
						: Number(row.avg_block_time_seconds),
			},
		]),
	);

	const { rows: reorgRows } = await sql<{
		date: string;
		reorg_count: string | number;
	}>`
		SELECT
			to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
			COUNT(*)::bigint AS reorg_count
		FROM chain_reorgs
		WHERE detected_at >= now() - (${params.days} * interval '1 day')
		GROUP BY 1
	`.execute(db);

	const reorgMap = new Map(
		reorgRows.map((row) => [row.date, Number(row.reorg_count)]),
	);

	const dates = new Set<string>([...blockMap.keys(), ...reorgMap.keys()]);
	return Array.from(dates)
		.sort((a, b) => (a < b ? 1 : -1))
		.map((date) => {
			const blocks = blockMap.get(date);
			return {
				date,
				block_count: blocks?.blockCount ?? 0,
				avg_block_time_seconds: blocks?.avgBlockTime ?? null,
				reorg_count: reorgMap.get(date) ?? 0,
			};
		});
}

export function parseNetworkHealthQuery(query: URLSearchParams): {
	days: number;
} {
	return { days: parseDaysParam(query.get("days")) };
}

export async function getNetworkHealthResponse(opts: {
	query: URLSearchParams;
	tip: { block_height: number } | null;
}): Promise<NetworkHealthSummary> {
	const parsed = parseNetworkHealthQuery(opts.query);
	const days = await readNetworkHealth({ days: parsed.days });
	return { days, tip: opts.tip };
}
