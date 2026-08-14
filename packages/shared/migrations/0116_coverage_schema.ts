import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Coverage kernel — registry, runs, per-block receipts, compacted segments,
 * and failures. Lives on the source plane with the chain it attests.
 *
 * Constraints here must match `src/coverage/constraints.ts`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE TABLE stage_registry (
				id TEXT PRIMARY KEY,
				kind TEXT NOT NULL
					CHECK (kind IN ('raw', 'decode', 'subgraph', 'queue')),
				depends_on TEXT REFERENCES stage_registry (id),
				native_clock TEXT NOT NULL
					CHECK (native_clock IN ('block', 'cursor', 'queue')),
				producer_version TEXT NOT NULL,
				repair_mode TEXT NOT NULL
					CHECK (repair_mode IN (
						'range_safe', 'full_reindex', 'archive_replay', 'none'
					)),
				enabled BOOLEAN NOT NULL DEFAULT true,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`.execute(db);

		await sql`
			CREATE TABLE stage_runs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				stage_id TEXT NOT NULL REFERENCES stage_registry (id),
				code_hash TEXT NOT NULL,
				config_hash TEXT NOT NULL,
				handler_hash TEXT,
				target_height BIGINT CHECK (target_height IS NULL OR target_height >= 0),
				target_cursor TEXT,
				status TEXT NOT NULL
					CHECK (status IN (
						'pending', 'running', 'complete', 'syncing', 'lagging',
						'gap', 'stale', 'failed', 'unverified_import', 'unanchored',
						'source_unavailable', 'out_of_scope', 'disabled', 'halted'
					)),
				complete_through BIGINT
					CHECK (complete_through IS NULL OR complete_through >= 0),
				started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				finished_at TIMESTAMPTZ
			)
		`.execute(db);

		await sql`
			CREATE INDEX stage_runs_stage_started_idx
				ON stage_runs (stage_id, started_at DESC)
		`.execute(db);

		await sql`
			CREATE TABLE stage_block_receipts (
				id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				stage_id TEXT NOT NULL REFERENCES stage_registry (id),
				run_id UUID REFERENCES stage_runs (id) ON DELETE SET NULL,
				block_height BIGINT NOT NULL CHECK (block_height >= 0),
				block_hash TEXT NOT NULL,
				input_count INTEGER NOT NULL CHECK (input_count >= 0),
				input_digest TEXT NOT NULL,
				effect_digest TEXT NOT NULL,
				finalized BOOLEAN NOT NULL DEFAULT false,
				compacted_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT stage_block_receipts_compacted_finalized
					CHECK (compacted_at IS NULL OR finalized),
				CONSTRAINT stage_block_receipts_stage_height_hash_key
					UNIQUE (stage_id, block_height, block_hash)
			)
		`.execute(db);

		await sql`
			CREATE INDEX stage_block_receipts_open_idx
				ON stage_block_receipts (stage_id, block_height)
				WHERE compacted_at IS NULL
		`.execute(db);

		await sql`
			CREATE TABLE coverage_segments (
				id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				stage_id TEXT NOT NULL REFERENCES stage_registry (id),
				from_height BIGINT NOT NULL CHECK (from_height >= 0),
				to_height BIGINT NOT NULL,
				chain_digest TEXT NOT NULL,
				input_digest TEXT NOT NULL,
				output_digest TEXT NOT NULL,
				sealed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT coverage_segments_range_ordered
					CHECK (from_height <= to_height),
				CONSTRAINT coverage_segments_stage_range_key
					UNIQUE (stage_id, from_height, to_height)
			)
		`.execute(db);

		await sql`
			CREATE INDEX coverage_segments_stage_from_idx
				ON coverage_segments (stage_id, from_height, to_height)
		`.execute(db);

		await sql`
			CREATE TABLE stage_failures (
				id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				stage_id TEXT NOT NULL REFERENCES stage_registry (id),
				run_id UUID REFERENCES stage_runs (id) ON DELETE SET NULL,
				unit_kind TEXT NOT NULL
					CHECK (unit_kind IN ('block', 'range', 'cursor', 'queue')),
				from_height BIGINT CHECK (from_height IS NULL OR from_height >= 0),
				to_height BIGINT CHECK (to_height IS NULL OR to_height >= 0),
				class TEXT NOT NULL
					CHECK (class IN (
						'omission', 'version', 'digest_mismatch', 'crash',
						'reorg', 'source_gap', 'handler', 'timeout', 'unknown'
					)),
				retry_state TEXT NOT NULL
					CHECK (retry_state IN ('open', 'retrying', 'halted', 'resolved')),
				retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
				last_error TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				resolved_at TIMESTAMPTZ,
				retain_until TIMESTAMPTZ NOT NULL
					DEFAULT (now() + interval '30 days'),
				CONSTRAINT stage_failures_range_ordered
					CHECK (
						from_height IS NULL
						OR to_height IS NULL
						OR from_height <= to_height
					),
				CONSTRAINT stage_failures_retain_until
					CHECK (retain_until >= created_at),
				CONSTRAINT stage_failures_resolved_at
					CHECK (retry_state <> 'resolved' OR resolved_at IS NOT NULL)
			)
		`.execute(db);

		await sql`
			CREATE INDEX stage_failures_open_idx
				ON stage_failures (stage_id, retry_state, created_at)
				WHERE retry_state <> 'resolved'
		`.execute(db);

		await sql`
			CREATE INDEX stage_failures_retain_until_idx
				ON stage_failures (retain_until)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS stage_failures`.execute(db);
		await sql`DROP TABLE IF EXISTS coverage_segments`.execute(db);
		await sql`DROP TABLE IF EXISTS stage_block_receipts`.execute(db);
		await sql`DROP TABLE IF EXISTS stage_runs`.execute(db);
		await sql`DROP TABLE IF EXISTS stage_registry`.execute(db);
	});
}
