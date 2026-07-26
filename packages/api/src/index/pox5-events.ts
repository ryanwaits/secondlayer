import { isPox5DecoderEnabled } from "@secondlayer/shared";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Pox5EventTopic } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import type { StreamsReorg, StreamsReorgsReader } from "../streams/reorgs.ts";
import {
	type IndexCursorInput,
	encodeIndexCursor,
	parseFilter,
	parseIndexBaseQuery,
	parseNonNegativeInteger,
	readReorgsForEvents,
	toIsoOrNull,
} from "./_shared.ts";
import type { IndexTip } from "./tip.ts";

/**
 * Typed PoX-5 read surface over the already-decoded `pox5_events` table — the
 * raw decoded print log of the `pox-5` boot contract (SIP-045 Bitcoin Staking),
 * all 19 topics, one row per print, no opinion applied. The platform primitive
 * PoX-4's `/v1/index/stacking` was for the pox-4 era: that stream dries up
 * permanently at the epoch 4.0 hard fork, this one starts at block one.
 *
 * Packaging, not ingestion — the rows already exist with reorg-canonical
 * handling. Bond/staker/signer projections and per-cycle rollups are app-shaped
 * views and belong in the `pox5-bonds` subgraph, not here (charter:
 * docs/internal/charter/index-vs-subgraphs.md).
 *
 * Event-indexed like the other decoded-event endpoints: cursor =
 * `block_height:event_index` (the table's own primary key, so the pair is a
 * total order), sargable `(block_height, event_index)` keyset, reorg
 * reconciliation over the page's event range.
 */

const POX5_DISABLED_NOTE =
	"PoX-5 decoding is disabled (POX5_DECODER_ENABLED=false); the pox-5 feed is empty until re-enabled.";

/** The `pox5_events` topic vocabulary — mirrors the DB CHECK constraint and
 *  `Pox5EventTopic`. A Set, so the guard stays O(1) instead of a 19-arm chain. */
const POX5_TOPICS: ReadonlySet<string> = new Set<Pox5EventTopic>([
	"set-bond-admin",
	"set-pause-admin",
	"pause-rewards",
	"setup-bond",
	"add-to-allowlist",
	"register-for-bond",
	"update-bond-registration",
	"register-signer",
	"stake",
	"stake-update",
	"announce-l1-early-exit",
	"unstake-sbtc",
	"unstake",
	"calculate-rewards",
	"bond-distribution",
	"claim-rewards",
	"claim-staker-rewards-for-signer",
	"grant-signer-key",
	"revoke-signer-grant",
]);

function isPox5Topic(value: string): value is Pox5EventTopic {
	return POX5_TOPICS.has(value);
}

export const POX5_EVENTS_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"confirmed",
	"topic",
	"staker",
	"signer",
	"signer_manager",
	"bond_index",
	"reward_cycle",
] as const;

/** A raw decoded PoX-5 print event — the full `pox5_events` row. Promoted
 *  columns cover the hot query paths; `data` always carries the complete
 *  decoded tuple (including nested shapes: btc-lockup, bond-rewards lists,
 *  bond-periods) so no topic is lossy. */
export type Pox5Event = {
	cursor: string;
	block_height: number;
	block_time: string | null;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: Pox5EventTopic;
	staker: string | null;
	signer: string | null;
	signer_manager: string | null;
	bond_index: number | null;
	/** ustx, bigint-safe string. */
	amount_ustx: string | null;
	/** sats, bigint-safe string. */
	amount_sats: string | null;
	reward_cycle: number | null;
	first_reward_cycle: number | null;
	unlock_cycle: number | null;
	unlock_burn_height: number | null;
	is_l1_lock: boolean | null;
	signer_key: string | null;
	/** The full decoded print tuple as JSON. */
	data: unknown;
};

export type Pox5EventsResponse = {
	events: Pox5Event[];
	next_cursor: string | null;
	tip: IndexTip;
	reorgs: StreamsReorg[];
	notes?: string;
};

type Pox5BaseQuery = {
	cursor?: IndexCursorInput;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	cursorPastTip: boolean;
};

/** Base window/cursor parse + the `?confirmed=true` hard "settled" filter:
 *  clamp `to_height` to `tip.finalized_height` so only rows past the reorg
 *  margin are returned. Deliberately duplicated from the sBTC surface rather
 *  than hoisted into `_shared.ts` — refactoring that settled money-path module
 *  is not worth saving a dozen lines. */
function parsePox5BaseQuery(
	query: URLSearchParams,
	tip: IndexTip,
): Pox5BaseQuery {
	const base = parseIndexBaseQuery(query, tip);
	const confirmed = query.get("confirmed");
	if (confirmed !== null && confirmed !== "true" && confirmed !== "false") {
		throw new ValidationError("confirmed must be 'true' or 'false'");
	}
	if (confirmed === "true") {
		return { ...base, toHeight: Math.min(base.toHeight, tip.finalized_height) };
	}
	return base;
}

function parseIntegerFilter(
	value: string | undefined,
	name: string,
): number | undefined {
	if (value === undefined) return undefined;
	return parseNonNegativeInteger(value, name);
}

function keysetPredicate(after: IndexCursorInput): RawBuilder<unknown> {
	// Sargable row-values keyset over (block_height, event_index) — same form as
	// every other decoded-event read, so Postgres range-scans the page.
	return sql`(block_height, event_index) > (${after.block_height}, ${after.event_index})`;
}

// pox5_events carries its own NOT NULL `block_time` column (unlike pox4_calls /
// decoded_events, which need a correlated `blocks` lookup), so select it
// directly — no per-row subquery.
const POX5_EVENT_COLUMNS = sql`
	cursor,
	block_height,
	block_time,
	tx_id,
	tx_index,
	event_index,
	topic,
	staker,
	signer,
	signer_manager,
	bond_index,
	amount_ustx,
	amount_sats,
	reward_cycle,
	first_reward_cycle,
	unlock_cycle,
	unlock_burn_height,
	is_l1_lock,
	signer_key,
	data`;

type Pox5EventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date | string | null;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	topic: Pox5EventTopic;
	staker: string | null;
	signer: string | null;
	signer_manager: string | null;
	bond_index: string | number | null;
	amount_ustx: string | null;
	amount_sats: string | null;
	reward_cycle: string | number | null;
	first_reward_cycle: string | number | null;
	unlock_cycle: string | number | null;
	unlock_burn_height: string | number | null;
	is_l1_lock: boolean | null;
	signer_key: string | null;
	data: unknown;
};

function normalizePox5Event(row: Pox5EventDbRow): Pox5Event {
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: toIsoOrNull(row.block_time),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		topic: row.topic,
		staker: row.staker,
		signer: row.signer,
		signer_manager: row.signer_manager,
		bond_index: row.bond_index === null ? null : Number(row.bond_index),
		// Amounts stay strings: ustx/sats exceed Number's safe range.
		amount_ustx: row.amount_ustx,
		amount_sats: row.amount_sats,
		reward_cycle: row.reward_cycle === null ? null : Number(row.reward_cycle),
		first_reward_cycle:
			row.first_reward_cycle === null ? null : Number(row.first_reward_cycle),
		unlock_cycle: row.unlock_cycle === null ? null : Number(row.unlock_cycle),
		unlock_burn_height:
			row.unlock_burn_height === null ? null : Number(row.unlock_burn_height),
		is_l1_lock: row.is_l1_lock,
		signer_key: row.signer_key,
		// JSONB: the driver already yields parsed JSON and the decoder wrote it
		// JSON-safe (bigints → strings), so pass it through untouched.
		data: row.data,
	};
}

export type ReadPox5EventsParams = {
	after?: IndexCursorInput;
	fromHeight: number;
	toHeight: number;
	limit: number;
	topic?: Pox5EventTopic;
	staker?: string;
	signer?: string;
	signerManager?: string;
	bondIndex?: number;
	rewardCycle?: number;
	db?: Kysely<Database>;
};

export type ReadPox5EventsResult = {
	events: Pox5Event[];
	next_cursor: string | null;
};

export type Pox5EventsReader = (
	params: ReadPox5EventsParams,
) => Promise<ReadPox5EventsResult>;

export async function readPox5Events(
	params: ReadPox5EventsParams,
): Promise<ReadPox5EventsResult> {
	if (params.toHeight < params.fromHeight) {
		return { events: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();
	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`block_height >= ${params.fromHeight}`,
		sql`block_height <= ${params.toHeight}`,
	];
	if (params.topic) predicates.push(sql`topic = ${params.topic}`);
	if (params.staker) predicates.push(sql`staker = ${params.staker}`);
	if (params.signer) predicates.push(sql`signer = ${params.signer}`);
	if (params.signerManager) {
		predicates.push(sql`signer_manager = ${params.signerManager}`);
	}
	if (params.bondIndex !== undefined) {
		predicates.push(sql`bond_index = ${params.bondIndex}`);
	}
	if (params.rewardCycle !== undefined) {
		predicates.push(sql`reward_cycle = ${params.rewardCycle}`);
	}
	if (params.after) predicates.push(keysetPredicate(params.after));

	const { rows } = await sql<Pox5EventDbRow>`
		SELECT ${POX5_EVENT_COLUMNS}
		FROM pox5_events
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY block_height ASC, event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const events = rows.slice(0, params.limit).map(normalizePox5Event);
	const last = events.at(-1);
	return {
		events,
		next_cursor: last
			? encodeIndexCursor({
					block_height: last.block_height,
					event_index: last.event_index,
				})
			: null,
	};
}

export async function getPox5EventsResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readPox5Events?: Pox5EventsReader;
	readReorgs?: StreamsReorgsReader;
	decoderEnabled?: boolean;
}): Promise<Pox5EventsResponse> {
	const base = parsePox5BaseQuery(opts.query, opts.tip);
	const note =
		(opts.decoderEnabled ?? isPox5DecoderEnabled())
			? undefined
			: POX5_DISABLED_NOTE;

	const topicRaw = opts.query.get("topic") ?? undefined;
	if (topicRaw !== undefined && !isPox5Topic(topicRaw)) {
		throw new ValidationError(`unknown topic: ${topicRaw}`);
	}

	if (base.cursorPastTip) {
		return {
			events: [],
			next_cursor: base.cursorRaw ?? null,
			tip: opts.tip,
			reorgs: [],
			...(note ? { notes: note } : {}),
		};
	}

	const reader = opts.readPox5Events ?? readPox5Events;
	const result = await reader({
		after: base.cursor,
		fromHeight: base.fromHeight,
		toHeight: base.toHeight,
		limit: base.limit,
		topic: topicRaw,
		staker: parseFilter(opts.query.get("staker") ?? undefined, "staker"),
		signer: parseFilter(opts.query.get("signer") ?? undefined, "signer"),
		signerManager: parseFilter(
			opts.query.get("signer_manager") ?? undefined,
			"signer_manager",
		),
		bondIndex: parseIntegerFilter(
			opts.query.get("bond_index") ?? undefined,
			"bond_index",
		),
		rewardCycle: parseIntegerFilter(
			opts.query.get("reward_cycle") ?? undefined,
			"reward_cycle",
		),
	});
	const reorgs = await readReorgsForEvents(result.events, opts.readReorgs);
	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
		...(note ? { notes: note } : {}),
	};
}
