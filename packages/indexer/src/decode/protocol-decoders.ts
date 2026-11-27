import {
	blockEndCursor,
	committedHeight,
	decodeStreamsCursor,
	encodeStreamsCursor,
} from "@secondlayer/shared";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import type {
	StreamsEvent,
	StreamsEventType,
} from "@secondlayer/shared/streams-rows";
import type { Kysely } from "kysely";
import {
	readCanonicalStreamsEvents,
	readCanonicalStreamsEventsByTxId,
} from "../streams-events.ts";
import { getCurrentCanonicalTip } from "../streams-tip.ts";
import { DEFAULT_CLASSIC_BATCH_LIMIT } from "./classic-decoders.ts";
import {
	BNS_DECODER_NAME,
	BNS_V2_MAINNET_CONTRACT,
	decodeBnsPage,
	seedBnsCheckpointToTip,
} from "./decoders/bns.ts";
import {
	POX5_CONTRACT,
	POX5_DECODER_NAME,
	POX5_STREAM_TYPES,
	decodePox5Page,
} from "./decoders/pox-5.ts";
import {
	SBTC_DECODER_NAME,
	SBTC_STREAM_TYPES,
	type SbtcPageCarry,
	decodeSbtcPage,
	registryContractId,
	tokenContractId,
} from "./decoders/sbtc.ts";
import { readDecoderCheckpoint, writeDecoderCheckpoint } from "./storage.ts";

export const DEFAULT_PROTOCOL_MAX_PAGES_PER_CYCLE = 25;

export type ProtocolDecoderName =
	| typeof SBTC_DECODER_NAME
	| typeof POX5_DECODER_NAME
	| typeof BNS_DECODER_NAME;

export type ProtocolDecodeCycleOptions = {
	db?: Kysely<Database>;
	enabled?: readonly ProtocolDecoderName[];
	limit?: number;
	maxPagesPerCycle?: number;
};

export type ProtocolDecodeCycleResult = {
	progressed: boolean;
	decoded: number;
	decodedByDecoder: Partial<Record<ProtocolDecoderName, number>>;
	checkpoints: Partial<Record<ProtocolDecoderName, string | null>>;
	failures: { decoder: ProtocolDecoderName; error: unknown }[];
	pagesCommitted: number;
	readMs: number;
	commitMs: number;
	totalMs: number;
};

type DecodedPage = {
	events: readonly StreamsEvent[];
	checkpointCursor: string;
	startedFrom: string | null;
};

type ProtocolDecoderSpec = {
	name: ProtocolDecoderName;
	types: readonly StreamsEventType[];
	contractId: () => string | readonly string[];
	startCycle?: (
		db: Kysely<Database>,
		checkpoint: string | null,
	) => Promise<string | null>;
	createPageHandler: (
		db: Kysely<Database>,
	) => (page: DecodedPage) => Promise<number>;
};

const SPECS: readonly ProtocolDecoderSpec[] = [
	{
		name: SBTC_DECODER_NAME,
		types: SBTC_STREAM_TYPES,
		contractId: () => [registryContractId(), tokenContractId()],
		createPageHandler: (db) => {
			let carry: SbtcPageCarry = { lastMint: null };
			return async (page) => {
				const result = await decodeSbtcPage({
					db,
					events: page.events,
					checkpointCursor: page.checkpointCursor,
					startedFrom: page.startedFrom,
					carry,
					eventsByTxId: async (txId) =>
						(await readCanonicalStreamsEventsByTxId({ txId, db }))
							.events as StreamsEvent[],
				});
				carry = result.carry;
				return result.decoded;
			};
		},
	},
	{
		name: POX5_DECODER_NAME,
		types: POX5_STREAM_TYPES,
		contractId: () => POX5_CONTRACT,
		createPageHandler: (db) => async (page) =>
			(
				await decodePox5Page({
					db,
					events: page.events,
					checkpointCursor: page.checkpointCursor,
					startedFrom: page.startedFrom,
				})
			).decoded,
	},
	{
		name: BNS_DECODER_NAME,
		types: ["print"],
		contractId: () => BNS_V2_MAINNET_CONTRACT,
		startCycle: async (db, checkpoint) => {
			if (checkpoint !== null) return checkpoint;
			const seeded = await seedBnsCheckpointToTip(db);
			if (seeded !== null) {
				await writeDecoderCheckpoint({
					db,
					decoderName: BNS_DECODER_NAME,
					cursor: seeded,
				});
				logger.info("BNS decoder: seeded checkpoint to tip", {
					cursor: seeded,
				});
			}
			return seeded;
		},
		createPageHandler: (db) => async (page) =>
			(
				await decodeBnsPage({
					db,
					events: page.events,
					checkpointCursor: page.checkpointCursor,
					startedFrom: page.startedFrom,
				})
			).decoded,
	},
];

export async function runProtocolDecodeCycle(
	opts: ProtocolDecodeCycleOptions = {},
): Promise<ProtocolDecodeCycleResult> {
	const cycleStart = Date.now();
	const db = opts.db ?? getSourceDb();
	const limit = opts.limit ?? DEFAULT_CLASSIC_BATCH_LIMIT;
	const maxPages =
		opts.maxPagesPerCycle ?? DEFAULT_PROTOCOL_MAX_PAGES_PER_CYCLE;
	const enabled = new Set(opts.enabled ?? SPECS.map((spec) => spec.name));

	const result: ProtocolDecodeCycleResult = {
		progressed: false,
		decoded: 0,
		decodedByDecoder: {},
		checkpoints: {},
		failures: [],
		pagesCommitted: 0,
		readMs: 0,
		commitMs: 0,
		totalMs: 0,
	};

	const tip = await getCurrentCanonicalTip(db);
	if (tip) {
		for (const spec of SPECS) {
			if (!enabled.has(spec.name)) continue;
			try {
				await decodeUntilTip({
					db,
					spec,
					toHeight: tip.block_height,
					limit,
					maxPages,
					result,
				});
			} catch (error) {
				result.failures.push({ decoder: spec.name, error });
			}
		}
	}

	result.totalMs = Date.now() - cycleStart;
	return result;
}

async function decodeUntilTip(opts: {
	db: Kysely<Database>;
	spec: ProtocolDecoderSpec;
	toHeight: number;
	limit: number;
	maxPages: number;
	result: ProtocolDecodeCycleResult;
}): Promise<void> {
	const { db, spec, toHeight, limit, maxPages, result } = opts;
	let checkpoint = await readDecoderCheckpoint({
		db,
		decoderName: spec.name,
	});
	if (spec.startCycle) checkpoint = await spec.startCycle(db, checkpoint);
	result.checkpoints[spec.name] = checkpoint;
	result.decodedByDecoder[spec.name] ??= 0;

	const checkpointHeight = committedHeight(checkpoint);
	if (checkpointHeight !== null && checkpointHeight >= toHeight) return;

	const handlePage = spec.createPageHandler(db);
	let after = checkpoint ? decodeStreamsCursor(checkpoint) : undefined;
	for (let pages = 0; pages < maxPages; pages++) {
		const readStart = Date.now();
		const page = await readCanonicalStreamsEvents({
			db,
			after,
			toHeight,
			types: spec.types,
			contractId: spec.contractId(),
			limit,
		});
		result.readMs += Date.now() - readStart;
		const events = page.events as StreamsEvent[];
		const shortPage = events.length < limit;
		const boundary = page.next_cursor ?? events.at(-1)?.cursor ?? null;
		const checkpointCursor = shortPage
			? encodeStreamsCursor(blockEndCursor(toHeight))
			: boundary;
		if (checkpointCursor === null) return;

		const commitStart = Date.now();
		const decoded = await handlePage({
			events,
			checkpointCursor,
			startedFrom: checkpoint,
		});
		result.commitMs += Date.now() - commitStart;
		result.pagesCommitted++;
		result.progressed = true;
		result.decoded += decoded;
		result.decodedByDecoder[spec.name] =
			(result.decodedByDecoder[spec.name] ?? 0) + decoded;

		checkpoint = checkpointCursor;
		result.checkpoints[spec.name] = checkpoint;
		if (shortPage) return;
		after = decodeStreamsCursor(checkpointCursor);
	}
}
