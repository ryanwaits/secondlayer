import {
	DEFAULT_BTC_CONFIRMATIONS,
	finalizedBurnHeight,
} from "@secondlayer/shared";
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import { getFinalizedStacksHeight } from "../streams-tip.ts";

export const CANONICAL_AUDIT_SCHEMA_VERSION = 1;

export type CanonicalCoverageAudit = {
	schema_version: typeof CANONICAL_AUDIT_SCHEMA_VERSION;
	generated_at: string;
	network: string;
	assurance: "db-reconstructive";
	source: "postgres-canonical-snapshot";
	coverage: {
		from_block: number | null;
		to_block: number | null;
	};
	counts: {
		blocks: number;
		transactions: number;
		events: number;
	};
	continuity: CanonicalContinuity;
	observer_journal: {
		available: boolean;
		sequence_from: string | null;
		sequence_to: string | null;
		processed: number;
		received: number;
		failed: number;
		paths: string[];
	};
};

export type CanonicalContinuity = {
	healthy: boolean;
	complete: boolean;
	start_mismatch: boolean;
	prefix_gap: { from_block: number; to_block: number } | null;
	suffix_gap: { from_block: number; to_block: number } | null;
	suffix_checked: boolean;
	gap_count: number;
	missing_blocks: number;
	first_gap: { from_block: number; to_block: number } | null;
	broken_link_count: number;
	first_broken_link_height: number | null;
	duplicate_height_count: number;
	first_duplicate_height: number | null;
};

export function summarizeCanonicalContinuity(input: {
	fromBlock: number | null;
	toBlock: number | null;
	expectedFromBlock: number;
	expectedToBlock?: number;
	gapCount: number;
	missingBlocks: number;
	firstGap: { from_block: number; to_block: number } | null;
	brokenLinkCount: number;
	firstBrokenLinkHeight: number | null;
	duplicateHeightCount: number;
	firstDuplicateHeight: number | null;
}): CanonicalContinuity {
	const prefixGap =
		input.fromBlock !== null && input.fromBlock > input.expectedFromBlock
			? {
					from_block: input.expectedFromBlock,
					to_block: input.fromBlock - 1,
				}
			: null;
	const prefixMissing = prefixGap
		? prefixGap.to_block - prefixGap.from_block + 1
		: 0;
	const suffixGap =
		input.expectedToBlock !== undefined &&
		input.toBlock !== null &&
		input.toBlock < input.expectedToBlock
			? {
					from_block: input.toBlock + 1,
					to_block: input.expectedToBlock,
				}
			: null;
	const suffixMissing = suffixGap
		? suffixGap.to_block - suffixGap.from_block + 1
		: 0;

	const healthy =
		input.fromBlock !== null &&
		input.fromBlock === input.expectedFromBlock &&
		prefixGap === null &&
		suffixGap === null &&
		input.gapCount === 0 &&
		input.brokenLinkCount === 0 &&
		input.duplicateHeightCount === 0;

	return {
		healthy,
		complete: healthy && input.expectedToBlock !== undefined,
		start_mismatch:
			input.fromBlock !== null && input.fromBlock !== input.expectedFromBlock,
		prefix_gap: prefixGap,
		suffix_gap: suffixGap,
		suffix_checked: input.expectedToBlock !== undefined,
		gap_count: input.gapCount,
		missing_blocks: input.missingBlocks + prefixMissing + suffixMissing,
		first_gap: input.firstGap,
		broken_link_count: input.brokenLinkCount,
		first_broken_link_height: input.firstBrokenLinkHeight,
		duplicate_height_count: input.duplicateHeightCount,
		first_duplicate_height: input.firstDuplicateHeight,
	};
}

export type CanonicalCoverageAuditOptions = {
	network: string;
	expectedFromBlock?: number;
	expectedToBlock?: number;
	generatedAt?: string;
	db?: Kysely<Database>;
};

type CountRow = { count: string | number };

/**
 * Audit the canonical product database in one repeatable-read snapshot.
 *
 * This intentionally reports `db-reconstructive`: it proves the exported
 * canonical tables are internally complete, not that an observer callback was
 * never omitted before the durable journal existed. Without `expectedToBlock`,
 * the result is a contiguous-prefix diagnostic and `continuity.complete` is
 * false.
 */
export async function auditCanonicalCoverage(
	options: CanonicalCoverageAuditOptions,
): Promise<CanonicalCoverageAudit> {
	const db = options.db ?? getSourceDb();
	const expectedFromBlock = options.expectedFromBlock ?? 0;
	const expectedToBlock = options.expectedToBlock;
	const generatedAt = options.generatedAt ?? new Date().toISOString();

	return db.transaction().execute(async (tx) => {
		await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(
			tx,
		);

		const coverage = await sql<{
			from_block: string | null;
			to_block: string | null;
			block_count: string | number;
		}>`
			SELECT
				MIN(height) AS from_block,
				MAX(height) AS to_block,
				COUNT(*) AS block_count
			FROM blocks
			WHERE canonical = true
		`.execute(tx);
		const coverageRow = coverage.rows[0];
		const fromBlock = nullableNumber(coverageRow?.from_block);
		const toBlock = nullableNumber(coverageRow?.to_block);

		const transactionCount = await countCanonicalRows(
			tx,
			"transactions",
			"block_height",
		);
		const eventCount = await countCanonicalRows(tx, "events", "block_height");
		const gaps = await summarizeGaps(tx);
		const brokenLinks = await summarizeBrokenLinks(tx);
		const duplicateHeights = await summarizeDuplicateHeights(tx);

		const journal = await readObserverJournal(tx, options.network);
		const continuity = summarizeCanonicalContinuity({
			fromBlock,
			toBlock,
			expectedFromBlock,
			expectedToBlock,
			gapCount: gaps.gap_count,
			missingBlocks: gaps.missing_blocks,
			firstGap: gaps.first_gap,
			brokenLinkCount: brokenLinks.broken_link_count,
			firstBrokenLinkHeight: brokenLinks.first_broken_link_height,
			duplicateHeightCount: duplicateHeights.duplicate_height_count,
			firstDuplicateHeight: duplicateHeights.first_duplicate_height,
		});

		return {
			schema_version: CANONICAL_AUDIT_SCHEMA_VERSION,
			generated_at: generatedAt,
			network: options.network,
			assurance: "db-reconstructive",
			source: "postgres-canonical-snapshot",
			coverage: { from_block: fromBlock, to_block: toBlock },
			counts: {
				blocks: Number(coverageRow?.block_count ?? 0),
				transactions: transactionCount,
				events: eventCount,
			},
			continuity,
			observer_journal: journal,
		};
	});
}

async function countCanonicalRows(
	db: Kysely<Database>,
	table: "transactions" | "events",
	blockColumn: "block_height",
): Promise<number> {
	const { rows } = await sql<CountRow>`
		SELECT COUNT(*) AS count
		FROM ${sql.table(table)} AS child
		INNER JOIN blocks AS block
			ON block.height = child.${sql.ref(blockColumn)}
			AND block.canonical = true
		`.execute(db);
	return Number(rows[0]?.count ?? 0);
}

async function summarizeGaps(db: Kysely<Database>): Promise<{
	gap_count: number;
	missing_blocks: number;
	first_gap: { from_block: number; to_block: number } | null;
}> {
	const { rows } = await sql<{
		gap_count: string | number;
		missing_blocks: string | number;
		first_gap_from: string | null;
		first_gap_to: string | null;
	}>`
		WITH ordered AS (
			SELECT
				height,
				LEAD(height) OVER (ORDER BY height) AS next_height
			FROM blocks
			WHERE canonical = true
		), gaps AS (
			SELECT height + 1 AS gap_from, next_height - 1 AS gap_to
			FROM ordered
			WHERE next_height - height > 1
		)
		SELECT
			COUNT(*) AS gap_count,
			COALESCE(SUM(gap_to - gap_from + 1), 0) AS missing_blocks,
			MIN(gap_from) AS first_gap_from,
			MIN(gap_to) FILTER (WHERE gap_from = (SELECT MIN(gap_from) FROM gaps)) AS first_gap_to
		FROM gaps
		`.execute(db);
	const row = rows[0];
	return {
		gap_count: Number(row?.gap_count ?? 0),
		missing_blocks: Number(row?.missing_blocks ?? 0),
		first_gap:
			row?.first_gap_from !== null && row?.first_gap_from !== undefined
				? {
						from_block: Number(row.first_gap_from),
						to_block: Number(row.first_gap_to),
					}
				: null,
	};
}

async function summarizeBrokenLinks(db: Kysely<Database>): Promise<{
	broken_link_count: number;
	first_broken_link_height: number | null;
}> {
	// Missing parent heights are reported by summarizeGaps. This query covers
	// the distinct case where both rows exist but the child's parent hash differs.
	const { rows } = await sql<{
		broken_link_count: string | number;
		first_broken_link_height: string | null;
	}>`
		SELECT
			COUNT(*) AS broken_link_count,
			MIN(child.height) AS first_broken_link_height
		FROM blocks AS child
		INNER JOIN blocks AS parent ON parent.height = child.height - 1
		WHERE child.canonical = true
			AND parent.canonical = true
			AND child.parent_hash <> parent.hash
		`.execute(db);
	const row = rows[0];
	return {
		broken_link_count: Number(row?.broken_link_count ?? 0),
		first_broken_link_height: nullableNumber(row?.first_broken_link_height),
	};
}

async function summarizeDuplicateHeights(db: Kysely<Database>): Promise<{
	duplicate_height_count: number;
	first_duplicate_height: number | null;
}> {
	const { rows } = await sql<{
		duplicate_height_count: string | number;
		first_duplicate_height: string | null;
	}>`
		SELECT
			COUNT(*) AS duplicate_height_count,
			MIN(height) AS first_duplicate_height
		FROM (
			SELECT height
			FROM blocks
			WHERE canonical = true
			GROUP BY height
			HAVING COUNT(*) > 1
		) AS duplicate_heights
	`.execute(db);
	const row = rows[0];
	return {
		duplicate_height_count: Number(row?.duplicate_height_count ?? 0),
		first_duplicate_height: nullableNumber(row?.first_duplicate_height),
	};
}

async function readObserverJournal(
	db: Kysely<Database>,
	network: string,
): Promise<CanonicalCoverageAudit["observer_journal"]> {
	const relation = await sql<{ relation: string | null }>`
		SELECT to_regclass('public.observer_journal') AS relation
		`.execute(db);
	if (!relation.rows[0]?.relation) {
		return {
			available: false,
			sequence_from: null,
			sequence_to: null,
			processed: 0,
			received: 0,
			failed: 0,
			paths: [],
		};
	}

	const { rows } = await sql<{
		sequence_from: string | null;
		sequence_to: string | null;
		processed: string | number;
		received: string | number;
		failed: string | number;
		paths: string[] | null;
	}>`
		SELECT
			MIN(sequence) AS sequence_from,
			MAX(sequence) AS sequence_to,
			COUNT(*) FILTER (WHERE status = 'processed') AS processed,
			COUNT(*) FILTER (WHERE status = 'received') AS received,
			COUNT(*) FILTER (WHERE status = 'failed') AS failed,
			ARRAY_REMOVE(ARRAY_AGG(DISTINCT path ORDER BY path), NULL) AS paths
		FROM observer_journal
		WHERE network = ${network}
		`.execute(db);
	const row = rows[0];
	return {
		available: true,
		sequence_from: row?.sequence_from ?? null,
		sequence_to: row?.sequence_to ?? null,
		processed: Number(row?.processed ?? 0),
		received: Number(row?.received ?? 0),
		failed: Number(row?.failed ?? 0),
		paths: row?.paths ?? [],
	};
}

function nullableNumber(
	value: string | number | null | undefined,
): number | null {
	return value === null || value === undefined ? null : Number(value);
}

/**
 * `STACKS_EXPECTED_TO_BLOCK=auto` — bound the audit at the burn-confirmation
 * finality boundary instead of a hand-picked height, so a scheduled run always
 * audits genesis→finalized without an operator refreshing the number. Uses the
 * same rule as the streams-bulk publisher: burn tip − N confirmations, mapped
 * to the highest Stacks height anchored at or below it.
 */
async function resolveAutoExpectedToBlock(): Promise<number> {
	const db = getSourceDb();
	const confirmations =
		parseOptionalInteger(process.env.CANONICAL_AUDIT_BTC_CONFIRMATIONS) ??
		DEFAULT_BTC_CONFIRMATIONS;
	const burnTip = await db
		.selectFrom("blocks")
		.select(({ fn }) => fn.max("burn_block_height").as("burn_tip"))
		.where("canonical", "=", true)
		.executeTakeFirst();
	const tip = Number(burnTip?.burn_tip ?? 0);
	if (!Number.isSafeInteger(tip) || tip <= 0) {
		throw new Error("no canonical blocks to derive a finalized bound from");
	}
	const finalized = await getFinalizedStacksHeight(
		finalizedBurnHeight(tip, confirmations),
		db,
	);
	if (finalized <= 0) {
		throw new Error("no finalized canonical height yet — cannot bound audit");
	}
	return finalized;
}

async function main(): Promise<void> {
	const network = process.env.STACKS_NETWORK ?? "mainnet";
	const expectedToRaw = process.env.STACKS_EXPECTED_TO_BLOCK;
	const expectedToBlock =
		expectedToRaw === "auto"
			? await resolveAutoExpectedToBlock()
			: parseOptionalInteger(expectedToRaw);
	const report = await auditCanonicalCoverage({
		network,
		expectedFromBlock: parseOptionalInteger(
			process.env.STACKS_EXPECTED_FROM_BLOCK,
		),
		expectedToBlock,
	});
	console.log(JSON.stringify(report, null, 2));
	if (!report.continuity.complete) process.exitCode = 2;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`expected a non-negative integer, got ${value}`);
	}
	return parsed;
}

if (import.meta.main) {
	main()
		.catch((error) => {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 1;
		})
		.finally(async () => {
			await closeDb();
		});
}
