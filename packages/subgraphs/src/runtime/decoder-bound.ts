import { decodeStreamsCursor, isEmptyRangeCursor } from "@secondlayer/shared";
import { type Database, getSourceDb } from "@secondlayer/shared/db";
import {
	defaultInternalIndexApiKey,
	defaultInternalIndexBaseUrl,
} from "@secondlayer/shared/index-internal-auth";
import { logger } from "@secondlayer/shared/logger";
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

/** The subset of `GET /public/status`'s `index.decoders[]` this reads. */
export type RemoteDecoderStatusEntry = {
	decoder: string;
	checkpointBlockHeight: number | null;
};

export type DecoderStatusLoader = () => Promise<RemoteDecoderStatusEntry[]>;

const REMOTE_STATUS_TIMEOUT_MS = 5_000;

/**
 * True when this process reads Index over HTTP with no guarantee a local
 * decoder ever runs in the same Postgres (a hosted tenant's `webhook-service`,
 * or any instance pointed at `SUBGRAPH_INDEX_API_URL`). `decoderBoundTip` then
 * must not read local `decoder_checkpoints` — that table is empty there and
 * the evaluator stalls forever (f091-class bug: chain webhooks never fire).
 */
function usesRemoteDecoderStatus(): boolean {
	return (
		process.env.SUBGRAPH_SOURCE === "streams-index" &&
		Boolean(process.env.SUBGRAPH_INDEX_API_URL)
	);
}

/**
 * Fetch decoder progress from the Index API's own `/public/status` — the same
 * endpoint operators already poll. Reuses the internal-index auth resolution
 * (`defaultInternalIndexBaseUrl`/`defaultInternalIndexApiKey`) that
 * `IndexHttpClient` uses, so it targets the same base URL and sends the same
 * bearer (harmless here — `/public/status` needs no auth).
 */
async function fetchRemoteDecoderStatus(): Promise<RemoteDecoderStatusEntry[]> {
	const baseUrl = defaultInternalIndexBaseUrl().replace(/\/+$/, "");
	const apiKey = defaultInternalIndexApiKey();
	const headers: Record<string, string> = apiKey
		? { authorization: `Bearer ${apiKey}` }
		: {};
	const res = await fetch(`${baseUrl}/public/status`, {
		headers,
		signal: AbortSignal.timeout(REMOTE_STATUS_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`GET ${baseUrl}/public/status → ${res.status}`);
	}
	const body = (await res.json()) as {
		index?: { decoders?: RemoteDecoderStatusEntry[] };
	};
	return body.index?.decoders ?? [];
}

/**
 * Remote-status variant of the floor below: same missing/floor semantics,
 * sourced from the Index API's decoder progress instead of local
 * `decoder_checkpoints`. `checkpointBlockHeight` is the checkpoint cursor's
 * raw block height (`health.ts` `cursorBlockHeight` — not floored for a
 * mid-block cursor the way `committedHeight` is), so it gets the same
 * conservative `-1`: costs at most one block of latency, never risks
 * processing past a partially-decoded block.
 *
 * Any failure (unreachable, non-2xx, bad JSON) stalls rather than falling
 * through to the unbounded raw tip — same fail-closed posture as a missing
 * local checkpoint.
 */
async function remoteDecoderBoundTip(
	decoderNames: string[],
	loadStatus: DecoderStatusLoader,
): Promise<DecoderBound> {
	let entries: RemoteDecoderStatusEntry[];
	try {
		entries = await loadStatus();
	} catch (err) {
		logger.warn("Chain evaluator: remote index status unreachable", {
			event: "chain_evaluator_decoder_status_unreachable",
			error: err instanceof Error ? err.message : String(err),
		});
		return { kind: "stall", missing: decoderNames };
	}
	const byName = new Map(
		entries.map((e) => [e.decoder, e.checkpointBlockHeight]),
	);
	const missing: string[] = [];
	const heights: number[] = [];
	for (const name of decoderNames) {
		const checkpointBlockHeight = byName.get(name);
		if (checkpointBlockHeight === undefined || checkpointBlockHeight === null) {
			missing.push(name);
		} else {
			heights.push(Math.max(0, checkpointBlockHeight - 1));
		}
	}
	if (missing.length > 0) return { kind: "stall", missing };
	return { kind: "height", height: Math.min(...heights) };
}

/**
 * Data-availability floor for `decoderNames`. On an instance that reads Index
 * over HTTP (`SUBGRAPH_SOURCE=streams-index` + `SUBGRAPH_INDEX_API_URL`),
 * sources progress from that API's `/public/status` instead — the local
 * `decoder_checkpoints` table only has rows when a decoder runs in the same
 * Postgres, which a hosted tenant's `webhook-service` never does.
 *
 * Otherwise reads SOURCE-plane `decoder_checkpoints` directly (same rationale
 * as trait resolution: the consumer handle is often the TARGET, where those
 * rows are empty).
 */
export async function decoderBoundTip(
	decoderNames: string[],
	opts?: { sourceDb?: Kysely<Database>; statusLoader?: DecoderStatusLoader },
): Promise<DecoderBound> {
	if (decoderNames.length === 0) return { kind: "unbounded" };
	if (usesRemoteDecoderStatus()) {
		return remoteDecoderBoundTip(
			decoderNames,
			opts?.statusLoader ?? fetchRemoteDecoderStatus,
		);
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
	opts?: { sourceDb?: Kysely<Database>; statusLoader?: DecoderStatusLoader },
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
