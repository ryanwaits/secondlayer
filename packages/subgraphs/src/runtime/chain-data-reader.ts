import type {
	Database,
	SbtcEventTopic,
	SbtcEventsTable,
} from "@secondlayer/shared/db";
import { getSourceDb } from "@secondlayer/shared/db";
import { resolveTraitContractIds } from "@secondlayer/shared/db/queries/contracts";
import { hasNoLocalChain } from "@secondlayer/shared/db/queries/instance";
import type {
	IndexHttpClient,
	IndexSbtcEventRow,
	IndexSbtcWithdrawalRow,
} from "@secondlayer/shared/index-http";
import type { Kysely, Selectable } from "kysely";
import { buildHttpClient } from "./block-source.ts";
import { isoToUnixSeconds } from "./reconstruct.ts";

/**
 * The chain reads webhook triggers and trait-scoped subgraph sources make
 * beyond the block stream: sBTC protocol events, trait membership, and sBTC
 * settlements. A stack with a local chain reads its own tables; a hosted tenant
 * (no local chain, see `hasNoLocalChain`) has those tables EMPTY and reads the
 * hosted Index API instead. Both return the same row shapes, so matching,
 * payloads and dedup keys never depend on which one answered.
 */
export interface ChainDataReader {
	/** Canonical sBTC events in [fromHeight, toHeight] for `topics`. */
	sbtcEvents(
		fromHeight: number,
		toHeight: number,
		topics: readonly SbtcEventTopic[],
	): Promise<SbtcEventRow[]>;
	/** Contracts conforming to `trait` deployed at or before `asOfBlock`. */
	traitContractIds(trait: string, asOfBlock: number): Promise<string[]>;
	/** Confirmed sweeps with `confirmed_at > after`, each anchored to its
	 *  Stacks accept event and block. */
	settlementsConfirmedAfter(after: Date): Promise<SettlementScanRow[]>;
}

/**
 * The `sbtc_events` columns trigger matching and payloads read, as the
 * Postgres driver returns them: BIGINT columns (`block_height`, `request_id`)
 * arrive as strings at runtime despite the declared `number`. The hosted
 * reader reproduces that so a delivery is byte-identical either way.
 */
export type SbtcEventRow = Pick<
	Selectable<SbtcEventsTable>,
	| "topic"
	| "sender"
	| "bitcoin_txid"
	| "request_id"
	| "amount"
	| "sweep_txid"
	| "block_height"
	| "tx_id"
	| "event_index"
>;

export type SettlementScanRow = {
	sweep_txid: string;
	request_id: number;
	btc_confirmations: number;
	btc_block_height: number | null;
	confirmed_at: Date | null;
	tx_id: string;
	stacks_block_height: number;
	amount: string | null;
	sender: string | null;
	block_hash: string;
	block_timestamp: number;
};

// ── Local tables (self-host, platform) ──────────────────────────────────────

export function databaseChainDataReader(db: Kysely<Database>): ChainDataReader {
	return {
		async sbtcEvents(fromHeight, toHeight, topics) {
			if (topics.length === 0) return [];
			return db
				.selectFrom("sbtc_events")
				.selectAll()
				.where("block_height", ">=", fromHeight)
				.where("block_height", "<=", toHeight)
				.where("canonical", "=", true)
				.where("topic", "in", [...topics])
				.orderBy("block_height")
				.orderBy("event_index")
				.execute();
		},
		traitContractIds(trait, asOfBlock) {
			return resolveTraitContractIds(db, trait, asOfBlock);
		},
		settlementsConfirmedAfter(after) {
			return db
				.selectFrom("sbtc_settlements as s")
				.innerJoin("sbtc_events as e", (join) =>
					join
						.onRef("e.sweep_txid", "=", "s.sweep_txid")
						.on("e.topic", "=", "withdrawal-accept")
						.on("e.canonical", "=", true),
				)
				.innerJoin("blocks as b", (join) =>
					join
						.onRef("b.height", "=", "e.block_height")
						.on("b.canonical", "=", true),
				)
				.where("s.settlement_confirmed", "=", true)
				.where("s.confirmed_at", ">", after)
				.select([
					"s.sweep_txid",
					"s.request_id",
					"s.btc_confirmations",
					"s.block_height as btc_block_height",
					"s.confirmed_at",
					"e.tx_id",
					"e.block_height as stacks_block_height",
					"e.amount",
					"e.sender",
					"b.hash as block_hash",
					"b.timestamp as block_timestamp",
				])
				.execute();
		},
	};
}

// ── Hosted Index API (tenant stacks) ────────────────────────────────────────

/** `to_height` meaning "through the tip"; the server clamps it. */
const THROUGH_TIP = Number.MAX_SAFE_INTEGER;

type TraitMembers = {
	members: { contractId: string; blockHeight: number }[];
	/** Highest `asOfBlock` this fetch answers for: the asOf it was fetched at,
	 *  or the newest member's deploy height when that is later. */
	coveredThrough: number;
};

/** Trait membership per client, for the process lifetime. Membership only
 *  grows; a read past `coveredThrough` refetches. */
const traitCaches = new WeakMap<IndexHttpClient, Map<string, TraitMembers>>();

function traitCacheFor(client: IndexHttpClient): Map<string, TraitMembers> {
	let cache = traitCaches.get(client);
	if (!cache) {
		cache = new Map();
		traitCaches.set(client, cache);
	}
	return cache;
}

/** Mirror the Postgres driver's runtime row (BIGINT → string). */
function toSbtcEventRow(e: IndexSbtcEventRow): SbtcEventRow {
	return {
		topic: e.topic as SbtcEventTopic,
		sender: e.sender,
		bitcoin_txid: e.bitcoin_txid,
		request_id: (e.request_id === null
			? null
			: String(e.request_id)) as unknown as number | null,
		amount: e.amount,
		sweep_txid: e.sweep_txid,
		block_height: String(e.block_height) as unknown as number,
		tx_id: e.tx_id,
		event_index: e.event_index,
	};
}

/** Lowest request per sweep: a sweep can settle several requests at once. */
function oneWithdrawalPerSweep(
	rows: IndexSbtcWithdrawalRow[],
): IndexSbtcWithdrawalRow[] {
	const bySweep = new Map<string, IndexSbtcWithdrawalRow>();
	for (const row of rows) {
		if (!row.sweep_txid || !row.confirmed_at) continue;
		const seen = bySweep.get(row.sweep_txid);
		if (!seen || row.request_id < seen.request_id) {
			bySweep.set(row.sweep_txid, row);
		}
	}
	return [...bySweep.values()];
}

export function hostedChainDataReader(
	client: IndexHttpClient,
): ChainDataReader {
	return {
		async sbtcEvents(fromHeight, toHeight, topics) {
			if (topics.length === 0) return [];
			const rows = await client.fetchSbtcEvents(fromHeight, toHeight, topics);
			return rows.map(toSbtcEventRow);
		},
		async traitContractIds(trait, asOfBlock) {
			const cache = traitCacheFor(client);
			let entry = cache.get(trait);
			if (!entry || asOfBlock > entry.coveredThrough) {
				const rows = await client.listContractsByTrait(trait);
				const members = rows.map((r) => ({
					contractId: r.contract_id,
					blockHeight: Number(r.block_height),
				}));
				entry = {
					members,
					coveredThrough: Math.max(
						asOfBlock,
						...members.map((m) => m.blockHeight),
					),
				};
				cache.set(trait, entry);
			}
			return entry.members
				.filter((m) => m.blockHeight <= asOfBlock)
				.map((m) => m.contractId);
		},
		async settlementsConfirmedAfter(after) {
			const withdrawals = oneWithdrawalPerSweep(
				await client.fetchSettledWithdrawals(after),
			);
			const out: SettlementScanRow[] = [];
			for (const w of withdrawals) {
				const accepts = await client.fetchSbtcEvents(
					0,
					THROUGH_TIP,
					["withdrawal-accept"],
					{ requestId: w.request_id },
				);
				const accept = accepts
					.filter((e) => e.sweep_txid === w.sweep_txid)
					.at(-1);
				if (!accept) continue;
				const [block] = await client.walkBlocks(
					accept.block_height,
					accept.block_height,
				);
				if (!block) continue;
				out.push({
					sweep_txid: w.sweep_txid as string,
					request_id: w.request_id,
					btc_confirmations: w.btc_confirmations ?? 0,
					btc_block_height: w.btc_block_height,
					confirmed_at: new Date(w.confirmed_at as string),
					tx_id: accept.tx_id,
					stacks_block_height: accept.block_height,
					amount: accept.amount,
					sender: accept.sender,
					block_hash: block.block_hash,
					block_timestamp: isoToUnixSeconds(block.block_time),
				});
			}
			return out;
		},
	};
}

// ── Selection ───────────────────────────────────────────────────────────────

/**
 * The reader for this stack, decided on first use (so a caller with no sBTC or
 * trait triggers never pays the lookup). `localDb` is what a stack with a local
 * chain reads (default: the source plane). A hosted tenant reads `httpClient`
 * (default: the internal Index client) and never its own empty tables.
 */
export function chainDataReader(opts?: {
	localDb?: Kysely<Database>;
	httpClient?: IndexHttpClient;
}): ChainDataReader {
	let resolved: Promise<ChainDataReader> | undefined;
	const reader = (): Promise<ChainDataReader> => {
		resolved ??= (async () => {
			const localDb = opts?.localDb ?? getSourceDb();
			if (await hasNoLocalChain(getSourceDb())) {
				return hostedChainDataReader(opts?.httpClient ?? sharedHttpClient());
			}
			return databaseChainDataReader(localDb);
		})();
		return resolved;
	};
	return {
		sbtcEvents: async (...args) => (await reader()).sbtcEvents(...args),
		traitContractIds: async (...args) =>
			(await reader()).traitContractIds(...args),
		settlementsConfirmedAfter: async (...args) =>
			(await reader()).settlementsConfirmedAfter(...args),
	};
}

let processHttpClient: IndexHttpClient | undefined;

/** One client per process for callers without their own, so the trait cache
 *  (keyed by client) lives for the process. */
function sharedHttpClient(): IndexHttpClient {
	processHttpClient ??= buildHttpClient();
	return processHttpClient;
}
