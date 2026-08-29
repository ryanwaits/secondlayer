import { decodeStreamsCursor, isEmptyRangeCursor } from "@secondlayer/shared";
import { type Database, getSourceDb } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import type { SubgraphDefinition } from "../types.ts";
import { referencedIndexEventTypes } from "./block-source.ts";

/**
 * Decoder-progress bound for consumers that read decoded Index rows.
 *
 * Each decoded event type is produced by an independent decoder
 * (`decode.<event_type>.v1` — ADR-0008/0010). Index `getTip` tracks
 * `decode.ft_transfer.v1` (or ingestion, on the Postgres tap). A forward-only
 * cursor that processes a height before the decoder feeding a referenced type
 * has committed it misses the match and never revisits.
 *
 * Bound the tip by the MIN committed height over ONLY the decoders the
 * consumer actually reads. A stalled unreferenced decoder (idle pox4) must
 * never gate progress. A referenced decoder with no usable checkpoint stalls
 * the consumer rather than falling through to the raw tip.
 */

/** ADR checkpoint name. Subgraphs does not depend on `@secondlayer/indexer`. */
export function decoderNameForEventType(indexEventType: string): string {
	return `decode.${indexEventType}.v1`;
}

export function decoderNamesForIndexEventTypes(eventTypes: string[]): string[] {
	return eventTypes.map(decoderNameForEventType);
}

export function decoderNamesForSubgraph(
	subgraph: SubgraphDefinition,
): string[] {
	return decoderNamesForIndexEventTypes(referencedIndexEventTypes(subgraph));
}

/**
 * Highest height at which this cursor has fully committed. Mid-block
 * (`H:n`, n not the empty-range sentinel) means the rest of H is still
 * in flight — floor is H-1. Sentinel `H:2147483647` means H is done.
 */
export function committedHeight(
	cursor: string | null | undefined,
): number | null {
	if (!cursor) return null;
	try {
		const decoded = decodeStreamsCursor(cursor);
		if (isEmptyRangeCursor(decoded)) return decoded.block_height;
		return Math.max(0, decoded.block_height - 1);
	} catch {
		return null;
	}
}

export type DecoderBound =
	| { kind: "unbounded" }
	| { kind: "stall"; missing: string[] }
	| { kind: "height"; height: number };

/**
 * Data-availability floor for `decoderNames`. Reads SOURCE-plane
 * `decoder_checkpoints` (same rationale as trait resolution: the consumer
 * handle is often the TARGET, where those rows are empty).
 */
export async function decoderBoundTip(
	decoderNames: string[],
	opts?: { sourceDb?: Kysely<Database> },
): Promise<DecoderBound> {
	if (decoderNames.length === 0) return { kind: "unbounded" };
	const sourceDb = opts?.sourceDb ?? getSourceDb();
	const rows = await sourceDb
		.selectFrom("decoder_checkpoints")
		.select(["decoder_name", "last_cursor"])
		.where("decoder_name", "in", decoderNames)
		.execute();
	const byName = new Map(rows.map((r) => [r.decoder_name, r.last_cursor]));
	const missing: string[] = [];
	const heights: number[] = [];
	for (const name of decoderNames) {
		const height = committedHeight(byName.get(name));
		if (height === null) missing.push(name);
		else heights.push(height);
	}
	if (missing.length > 0) return { kind: "stall", missing };
	return { kind: "height", height: Math.min(...heights) };
}

export type BoundSourceTip =
	| { ok: true; tip: number; floor: number | null }
	| { ok: false; missing: string[] };

/** Combine a raw block-source tip with the decoder floor. */
export async function boundSourceTip(
	rawTip: number,
	decoderNames: string[],
	opts?: { sourceDb?: Kysely<Database> },
): Promise<BoundSourceTip> {
	const bound = await decoderBoundTip(decoderNames, opts);
	if (bound.kind === "stall") return { ok: false, missing: bound.missing };
	if (bound.kind === "unbounded") {
		return { ok: true, tip: rawTip, floor: null };
	}
	return {
		ok: true,
		tip: Math.min(rawTip, bound.height),
		floor: bound.height,
	};
}
