import { createHash } from "node:crypto";
import { SEMANTIC_DIGEST_SPEC_V1 } from "./semantic-digest.ts";

/**
 * Per-height semantic digest sidecars — enable "verify one block" without
 * downloading a whole 50k-block partition.
 *
 * The partition-level semantic digest is the shape a byte-level comparator
 * wants: one string per partition, cheap to compare in bulk. But a caller who
 * only cares about block 8_500_017 has to pull an entire Parquet file to check
 * one row. The per-height sidecar closes that gap: one 32-byte block digest and
 * two roll-up digests per height (transactions and events), addressable by
 * height without touching the raw datasets.
 *
 * Rollup rules (v1) — MUST match the exporter's stream order or an honest
 * re-derivation will disagree:
 *   - transactions_rollup: sha256(concat(tx_digest_bytes, tx_index asc, tx_id asc))
 *     `null` when the height has no transactions.
 *   - events_rollup:       sha256(concat(event_digest_bytes, event_index asc, tx_id asc))
 *     `null` when the height has no events.
 *   - block_digest:        the semantic-v1 block digest itself (one row per
 *                          height, so no rollup needed).
 *
 * `null` is deliberate: an empty rollup is not the sha256 of nothing (which
 * would collide across two empty datasets); an absent-here-but-present-elsewhere
 * dataset must never compare equal to a truly-empty one.
 */

export interface PerHeightDigestRow {
	height: number;
	block_digest: string;
	transactions_rollup: string | null;
	events_rollup: string | null;
}

interface Accumulator {
	block_digest: string | null;
	tx: ReturnType<typeof createHash>;
	tx_count: number;
	event: ReturnType<typeof createHash>;
	event_count: number;
}

export class PerHeightDigestAccumulator {
	private readonly rows = new Map<number, Accumulator>();

	setBlockDigest(height: number, blockDigestHex: string): void {
		this.ensure(height).block_digest = blockDigestHex;
	}

	appendTransactionDigest(height: number, digestHex: string): void {
		const a = this.ensure(height);
		a.tx.update(Buffer.from(digestHex, "hex"));
		a.tx_count += 1;
	}

	appendEventDigest(height: number, digestHex: string): void {
		const a = this.ensure(height);
		a.event.update(Buffer.from(digestHex, "hex"));
		a.event_count += 1;
	}

	/**
	 * Drain the accumulator into height-ascending rows. Heights with no block
	 * digest are dropped with a thrown error — a canonical partition MUST have
	 * a block at every height it covers, and silently emitting a row without
	 * one would hide the missing block from downstream verifiers.
	 */
	drain(fromBlock: number, toBlock: number): PerHeightDigestRow[] {
		const rows: PerHeightDigestRow[] = [];
		for (let h = fromBlock; h <= toBlock; h++) {
			const a = this.rows.get(h);
			if (!a) continue; // Missing entirely — surfaced by canonical audit, not here.
			if (!a.block_digest) {
				throw new Error(
					`per-height digest at ${h} has tx/event rollups but no block digest`,
				);
			}
			rows.push({
				height: h,
				block_digest: a.block_digest,
				transactions_rollup:
					a.tx_count === 0 ? null : a.tx.copy().digest("hex"),
				events_rollup:
					a.event_count === 0 ? null : a.event.copy().digest("hex"),
			});
		}
		return rows;
	}

	spec(): typeof SEMANTIC_DIGEST_SPEC_V1 {
		return SEMANTIC_DIGEST_SPEC_V1;
	}

	private ensure(height: number): Accumulator {
		let a = this.rows.get(height);
		if (!a) {
			a = {
				block_digest: null,
				tx: createHash("sha256"),
				tx_count: 0,
				event: createHash("sha256"),
				event_count: 0,
			};
			this.rows.set(height, a);
		}
		return a;
	}
}

/**
 * Registered in the snapshot manifest under `digest_index[]`. One entry per
 * partition, addressable at height granularity without downloading raw data.
 */
export interface DigestIndexPartition {
	from_block: number;
	to_block: number;
	path: string;
	row_count: number;
	byte_size: number;
	sha256: string;
	digest_spec: typeof SEMANTIC_DIGEST_SPEC_V1;
}
