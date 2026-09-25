import { committedHeight } from "@secondlayer/shared";
import { type Database, getSourceDb } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import type { SubgraphDefinition } from "../types.ts";
import {
	VM_INDEX_EVENT_TYPES,
	isStreamsIndexEligible,
	referencedIndexEventTypes,
} from "./block-source.ts";

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
	return eventTypes
		.filter((t) => !VM_INDEX_EVENT_TYPES.has(t))
		.map(decoderNameForEventType);
}

export function decoderNamesForSubgraph(
	subgraph: SubgraphDefinition,
): string[] {
	return decoderNamesForIndexEventTypes(referencedIndexEventTypes(subgraph));
}

/**
 * True when catch-up/reindex will load decoded Index rows (the race).
 * Postgres tap reads raw `events` at ingest and must not wait on decode.
 * Mirrors `resolveBlockSource`'s streams-index branch.
 */
export function usesDecodedIndexPlane(subgraph: SubgraphDefinition): boolean {
	return (
		process.env.SUBGRAPH_SOURCE === "streams-index" &&
		isStreamsIndexEligible(subgraph)
	);
}

// `committedHeight` moved to `@secondlayer/shared` (streams-cursor.ts) so the
// Index `/public/status` route and this module share one implementation of
// the committed-height rule. Re-exported here so existing importers of
// `./decoder-bound.ts` are unaffected.
export { committedHeight };

export type DecoderBound =
	| { kind: "unbounded" }
	| { kind: "stall"; missing: string[] }
	| { kind: "height"; height: number };

/**
 * True when this process reads Index over HTTP with no guarantee a local
 * decoder ever runs in the same Postgres (a hosted tenant's `webhook-service`,
 * or any instance pointed at `SUBGRAPH_INDEX_API_URL`). `decoderBoundTip` then
 * must not read local `decoder_checkpoints` — that table is empty there and
 * the evaluator stalls forever (otherwise chain webhooks never fire).
 */
function usesRemoteDecoderStatus(): boolean {
	return (
		process.env.SUBGRAPH_SOURCE === "streams-index" &&
		Boolean(process.env.SUBGRAPH_INDEX_API_URL)
	);
}

/**
 * Data-availability floor for `decoderNames`. On an instance that reads Index
 * over HTTP (`SUBGRAPH_SOURCE=streams-index` + `SUBGRAPH_INDEX_API_URL`) the
 * floor is `unbounded`: trust the block source's own tip. The Index API now
 * enforces the committed-height rule server-side (the Index tip is the MIN
 * committed height across every classic decoder — see
 * `packages/api/src/index/tip.ts`), so the tip already returned by
 * `PublicApiBlockSource.getTip()` (`IndexHttpClient.getIndexTip`/
 * `getIndexSourceTip`) is already a decoder-safe ceiling. A second,
 * decoder-status-specific request (the old `GET /public/status` poll every
 * tick) is redundant — this was the extra hop Gate 1 measured adding ~4s of
 * serial round-trip time to every evaluator tick.
 *
 * This trades a little precision for that hop: the global cross-decoder MIN
 * can be more conservative than the narrowest floor for `decoderNames`
 * specifically (e.g. an unrelated slow `print` decoder holding back a
 * `stx_transfer`-only webhook). Local mode below stays exactly scoped, since
 * it's a free extra DB predicate rather than a whole extra network call.
 *
 * Otherwise (local mode) reads SOURCE-plane `decoder_checkpoints` directly
 * (same rationale as trait resolution: the consumer handle is often the
 * TARGET, where those rows are empty).
 */
export async function decoderBoundTip(
	decoderNames: string[],
	opts?: { sourceDb?: Kysely<Database> },
): Promise<DecoderBound> {
	if (decoderNames.length === 0) return { kind: "unbounded" };
	if (usesRemoteDecoderStatus()) {
		return { kind: "unbounded" };
	}
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
