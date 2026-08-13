import { createHash } from "node:crypto";

/**
 * v1 canonical byte encoding for chain identity — the shape that lets
 * independently-run runtimes agree on the same block.
 *
 * The exact-body digest (`sha256:parquet-object`) proves capture fidelity to one
 * source: replay the same bytes, get the same rows. It cannot prove two nodes
 * observed the same chain, because their Parquet encoders legally differ in
 * column padding, compression, JSON key order, and null placement — two
 * operators processing the same block can ship byte-different Parquets that
 * carry identical content.
 *
 * The semantic digest is the shape that lets independent runtimes agree. Every
 * value on a block/transaction/event is normalized into a canonical byte string
 * by rules that MUST NOT change without a version bump. Two v1 computations
 * over the same range agree, or one is wrong about the chain — never about
 * formatting.
 *
 * Encoding rules (v1):
 *   - Fields join with `\x1f` (ASCII US, unit separator — cannot legally
 *     appear in any chain value; a printable delimiter risks collision with
 *     contract-emitted strings).
 *   - Null encodes as `\x00` (single NUL). Distinct from empty string `""`.
 *   - Integers encode as their base-10 string. bigint → decimal string.
 *   - JSON payload columns (function_args, event data) encode as canonical
 *     JSON: object keys sorted lexicographically, no whitespace, bigint →
 *     quoted decimal string, non-finite numbers rejected.
 *   - Field order per record type is fixed and never reordered.
 *   - Digest = sha256(bytes), lowercase hex.
 *
 * Rollup rules (v1) — order MUST match the archive's stream order or an
 * honest re-export will disagree with the manifest:
 *   - blocks:       (height asc)
 *   - transactions: (block_height asc, tx_index asc, tx_id asc)
 *   - events:       (block_height asc, event_index asc, tx_id asc)
 * Per-partition rollup is `sha256(concat(row_digest_bytes))` in stream order.
 *
 * Test vectors under `packages/shared/src/archive/__fixtures__/semantic-digest/`
 * pin the encoding. Any change to bytes must bump the spec version.
 */

export const SEMANTIC_DIGEST_SPEC_V1 = "sha256:semantic-v1" as const;
export type SemanticDigestSpec = typeof SEMANTIC_DIGEST_SPEC_V1;

const FIELD_SEP = "\x1f";
const NULL_MARKER = "\x00";

const textEncoder = new TextEncoder();

/**
 * Stable JSON — sorted keys, no whitespace, bigint → decimal string. Distinct
 * from `JSON.stringify(x)` which respects insertion order and rejects bigints.
 * Also rejects non-finite numbers, since NaN/Infinity have no on-chain meaning
 * and would silently hash as `null` under `JSON.stringify`.
 */
export function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error("canonicalJson: non-finite number");
		}
		return JSON.stringify(value);
	}
	if (typeof value === "bigint") return JSON.stringify(value.toString());
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	if (typeof value === "object") {
		const object = value as Record<string, unknown>;
		return `{${Object.keys(object)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
			.join(",")}}`;
	}
	// undefined / function / symbol — never present in decoded chain rows.
	// Fall through as null so tests catch unexpected shapes.
	return "null";
}

function scalar(value: string | number | bigint | null | undefined): string {
	if (value === null || value === undefined) return NULL_MARKER;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error("semanticDigest: non-finite number");
		}
		if (!Number.isInteger(value)) {
			// Chain heights, indexes, timestamps are all integer; a fractional
			// value here is a schema bug we want to surface loudly, not silently
			// serialize with float precision that varies by runtime.
			throw new Error(`semanticDigest: non-integer scalar ${value}`);
		}
		return String(value);
	}
	if (typeof value === "bigint") return value.toString();
	return value;
}

function jsonScalar(value: unknown): string {
	return value === null || value === undefined
		? NULL_MARKER
		: canonicalJson(value);
}

function sha256Hex(input: Uint8Array | string): string {
	return createHash("sha256").update(input).digest("hex");
}

export interface BlockDigestInput {
	height: number | bigint;
	hash: string;
	parent_hash: string;
	burn_block_height: number | bigint;
	burn_block_hash: string | null;
	index_block_hash: string | null;
	timestamp: number | bigint;
}

export interface TransactionDigestInput {
	tx_id: string;
	block_height: number | bigint;
	tx_index: number;
	type: string;
	sender: string;
	status: string;
	contract_id: string | null;
	function_name: string | null;
	function_args: unknown;
	raw_result: string | null;
	raw_tx: string;
}

export interface EventDigestInput {
	tx_id: string;
	block_height: number | bigint;
	event_index: number;
	type: string;
	data: unknown;
}

function encodeBlock(row: BlockDigestInput): string {
	return [
		scalar(row.height),
		scalar(row.hash),
		scalar(row.parent_hash),
		scalar(row.burn_block_height),
		scalar(row.burn_block_hash),
		scalar(row.index_block_hash),
		scalar(row.timestamp),
	].join(FIELD_SEP);
}

function encodeTransaction(row: TransactionDigestInput): string {
	return [
		scalar(row.tx_id),
		scalar(row.block_height),
		scalar(row.tx_index),
		scalar(row.type),
		scalar(row.sender),
		scalar(row.status),
		scalar(row.contract_id),
		scalar(row.function_name),
		jsonScalar(row.function_args),
		scalar(row.raw_result),
		scalar(row.raw_tx),
	].join(FIELD_SEP);
}

function encodeEvent(row: EventDigestInput): string {
	return [
		scalar(row.tx_id),
		scalar(row.block_height),
		scalar(row.event_index),
		scalar(row.type),
		jsonScalar(row.data),
	].join(FIELD_SEP);
}

/**
 * v1 per-row digests. Each is `sha256(encoded_row_bytes)` in lowercase hex.
 * The encoded byte form is stable across runtimes; the sha256 is stable
 * across CPU architectures. Never mutate an encoder without a v-bump.
 */
export const semanticDigest = {
	v1: {
		spec: SEMANTIC_DIGEST_SPEC_V1,
		encodeBlock,
		encodeTransaction,
		encodeEvent,
		block(row: BlockDigestInput): string {
			return sha256Hex(textEncoder.encode(encodeBlock(row)));
		},
		transaction(row: TransactionDigestInput): string {
			return sha256Hex(textEncoder.encode(encodeTransaction(row)));
		},
		event(row: EventDigestInput): string {
			return sha256Hex(textEncoder.encode(encodeEvent(row)));
		},
	},
} as const;

/**
 * Streaming rollup — feed rows one at a time in their declared order, read the
 * rolled digest at the end. Two callers passing the same rows in the same order
 * produce the same rollup, regardless of batching.
 *
 * The rollup composes: partition_digest = sha256(concat(row_digest_bytes)),
 * where each row_digest_bytes = sha256(encode(row)). This is why the streaming
 * implementation can be constant-memory — the outer sha256 accepts row digests
 * incrementally.
 */
export class SemanticDigestRollup {
	private readonly hasher = createHash("sha256");
	private count = 0;

	static forDataset(
		_dataset: "blocks" | "transactions" | "events",
	): SemanticDigestRollup {
		return new SemanticDigestRollup();
	}

	appendRowDigest(rowDigestHex: string): void {
		this.hasher.update(Buffer.from(rowDigestHex, "hex"));
		this.count += 1;
	}

	rowCount(): number {
		return this.count;
	}

	/** Empty rollups return `null`, not the sha256 of nothing, so an empty
	 *  range never compares equal to another empty range on a different
	 *  dataset. Callers assign `null` semantics deliberately. */
	digest(): string | null {
		return this.count === 0 ? null : this.hasher.copy().digest("hex");
	}

	spec(): SemanticDigestSpec {
		return SEMANTIC_DIGEST_SPEC_V1;
	}
}

/**
 * Per-partition digest record — the shape that lands in the snapshot manifest.
 * Complements the existing `sha256:parquet-object` per-partition digest by
 * proving semantic identity independent of file encoding.
 */
export interface PartitionSemanticDigest {
	dataset: "blocks" | "transactions" | "events";
	from_block: number;
	to_block: number;
	row_count: number;
	digest: string | null;
	digest_spec: SemanticDigestSpec;
}
