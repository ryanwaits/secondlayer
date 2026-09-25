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

/** Inverse of `decoderNameForEventType` — decoder names in this codebase are
 *  always exactly `decode.<type>.v1`, so stripping the fixed prefix/suffix is
 *  a lossless round trip. Needed because the wire's `decoded_heights` map
 *  (packages/api/src/index/tip.ts) is keyed by event_type (the Index API's
 *  own public vocabulary), not by decoder name. */
function eventTypeForDecoderName(decoderName: string): string {
	return decoderName.replace(/^decode\./, "").replace(/\.v1$/, "");
}

/**
 * Remote-mode variant of the floor below, scoped to `decoderNames` — same
 * missing/floor semantics as local mode, sourced from `decodedHeights` (the
 * SAME tip envelope `source.getTip()` already fetched; see
 * `IndexHttpClient.getDecodedHeights()`) instead of a local DB read. No
 * network call of its own — this is pure/synchronous.
 *
 * `decodedHeights` absent entirely (an older server that doesn't send the
 * field, or called before any `getTip()`) falls back to `unbounded`: the raw
 * tip IS already the conservative cross-decoder floor (`IndexTip.block_height`
 * — see packages/api/src/index/tip.ts), so trusting it outright is the same
 * as bounding by it explicitly, just without the redundant `Math.min`.
 *
 * A referenced decoder missing from the map, or present with `null` (no
 * checkpoint yet), stalls — same fail-closed rule local mode already applies.
 * An unreferenced decoder stalling (e.g. an idle `print`) never appears in
 * `decoderNames` and so can never gate this.
 */
function remoteDecoderBoundTip(
	decoderNames: string[],
	decodedHeights: Record<string, number | null> | undefined,
): DecoderBound {
	if (!decodedHeights) return { kind: "unbounded" };
	const missing: string[] = [];
	const heights: number[] = [];
	for (const decoderName of decoderNames) {
		const height = decodedHeights[eventTypeForDecoderName(decoderName)];
		if (height === undefined || height === null) missing.push(decoderName);
		else heights.push(height);
	}
	if (missing.length > 0) return { kind: "stall", missing };
	return { kind: "height", height: Math.min(...heights) };
}

/**
 * Data-availability floor for `decoderNames`. On an instance that reads Index
 * over HTTP (`SUBGRAPH_SOURCE=streams-index` + `SUBGRAPH_INDEX_API_URL`),
 * bounds by the referenced decoders' OWN committed heights from
 * `opts.remoteDecodedHeights` (the tip envelope the block source's `getTip()`
 * already fetched — no second request). A stalled UNREFERENCED decoder (e.g.
 * an idle `print`) must never gate progress — this only ever looks at
 * `decoderNames`, so it can't. Falls back to `unbounded` (trust the raw tip,
 * itself the conservative cross-decoder floor) when the caller has no
 * decoded-heights map to hand (an older server, or before any `getTip()`).
 *
 * Otherwise (local mode) reads SOURCE-plane `decoder_checkpoints` directly
 * (same rationale as trait resolution: the consumer handle is often the
 * TARGET, where those rows are empty).
 */
export async function decoderBoundTip(
	decoderNames: string[],
	opts?: {
		sourceDb?: Kysely<Database>;
		/** Remote mode only — see `remoteDecoderBoundTip`. */
		remoteDecodedHeights?: Record<string, number | null>;
	},
): Promise<DecoderBound> {
	if (decoderNames.length === 0) return { kind: "unbounded" };
	if (usesRemoteDecoderStatus()) {
		return remoteDecoderBoundTip(decoderNames, opts?.remoteDecodedHeights);
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
	opts?: {
		sourceDb?: Kysely<Database>;
		remoteDecodedHeights?: Record<string, number | null>;
	},
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
