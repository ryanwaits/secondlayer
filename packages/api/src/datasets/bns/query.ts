import { getSourceDb, sql } from "@secondlayer/shared/db";
import type {
	BnsMarketplaceAction,
	BnsNameEventTopic,
	BnsNamespaceEventStatus,
} from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import { decodeStreamsCursor } from "../../streams/cursor.ts";
import { STREAMS_BLOCKS_PER_DAY } from "../../streams/tiers.ts";

// ── Shared parsing helpers ─────────────────────────────────────────

function parseNonNegativeInteger(value: string, name: string): number {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}
	return parsed;
}

function parseLimit(value: string | undefined): number {
	if (value === undefined) return 200;
	const parsed = parseNonNegativeInteger(value, "limit");
	return Math.min(1000, Math.max(1, parsed));
}

function parseFilter(
	value: string | undefined,
	name: string,
): string | undefined {
	if (value === undefined) return undefined;
	if (value.length === 0) {
		throw new ValidationError(`${name} must not be empty`);
	}
	return value;
}

function parseCursor(value: string): {
	block_height: number;
	event_index: number;
} {
	try {
		return decodeStreamsCursor(value);
	} catch {
		throw new ValidationError("cursor must use <block_height>:<event_index>");
	}
}

const VALID_NAME_TOPICS = new Set<BnsNameEventTopic>([
	"new-name",
	"transfer-name",
	"renew-name",
	"burn-name",
	"new-airdrop",
]);

const VALID_NAMESPACE_STATUSES = new Set<BnsNamespaceEventStatus>([
	"launch",
	"transfer-manager",
	"freeze-manager",
	"update-price-manager",
	"freeze-price-manager",
	"turn-off-manager-transfers",
]);

const VALID_MARKETPLACE_ACTIONS = new Set<BnsMarketplaceAction>([
	"list-in-ustx",
	"unlist-in-ustx",
	"buy-in-ustx",
]);

function parseTopic(value: string | undefined): BnsNameEventTopic | undefined {
	if (value === undefined) return undefined;
	if (!VALID_NAME_TOPICS.has(value as BnsNameEventTopic)) {
		throw new ValidationError(`invalid topic: ${value}`);
	}
	return value as BnsNameEventTopic;
}

function parseNamespaceStatus(
	value: string | undefined,
): BnsNamespaceEventStatus | undefined {
	if (value === undefined) return undefined;
	if (!VALID_NAMESPACE_STATUSES.has(value as BnsNamespaceEventStatus)) {
		throw new ValidationError(`invalid status: ${value}`);
	}
	return value as BnsNamespaceEventStatus;
}

function parseMarketplaceAction(
	value: string | undefined,
): BnsMarketplaceAction | undefined {
	if (value === undefined) return undefined;
	if (!VALID_MARKETPLACE_ACTIONS.has(value as BnsMarketplaceAction)) {
		throw new ValidationError(`invalid action: ${value}`);
	}
	return value as BnsMarketplaceAction;
}

function bumpCursor(
	blockHeight: number,
	eventIndex: number,
): RawBuilder<unknown> {
	return sql`
		(
			block_height > ${blockHeight}
			OR (
				block_height = ${blockHeight}
				AND event_index > ${eventIndex}
			)
		)
	`;
}

// ── /v1/datasets/bns/name-events ───────────────────────────────────

export type BnsNameEventRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: BnsNameEventTopic;
	namespace: string;
	name: string;
	fqn: string;
	owner: string | null;
	bns_id: string;
	registered_at: number | null;
	imported_at: number | null;
	renewal_height: number | null;
	stx_burn: string | null;
	preordered_by: string | null;
	hashed_salted_fqn_preorder: string | null;
};

export type BnsNameEventsQuery = {
	cursor?: { block_height: number; event_index: number };
	cursorRaw?: string;
	fromBlock: number;
	toBlock: number;
	limit: number;
	topic?: BnsNameEventTopic;
	namespace?: string;
	name?: string;
	owner?: string;
};

export function parseBnsNameEventsQuery(
	query: URLSearchParams,
	tip: { block_height: number },
): BnsNameEventsQuery {
	const cursorRaw = query.get("cursor") ?? undefined;
	const fromBlockRaw = query.get("from_block") ?? undefined;
	const toBlockRaw = query.get("to_block") ?? undefined;
	if (cursorRaw && fromBlockRaw !== undefined) {
		throw new ValidationError("cursor and from_block are mutually exclusive");
	}
	const cursor = cursorRaw ? parseCursor(cursorRaw) : undefined;
	const defaultFromBlock = Math.max(
		0,
		tip.block_height - STREAMS_BLOCKS_PER_DAY,
	);
	const fromBlock =
		fromBlockRaw !== undefined
			? parseNonNegativeInteger(fromBlockRaw, "from_block")
			: cursorRaw !== undefined
				? 0
				: defaultFromBlock;
	const toBlock =
		toBlockRaw !== undefined
			? Math.min(
					parseNonNegativeInteger(toBlockRaw, "to_block"),
					tip.block_height,
				)
			: tip.block_height;
	return {
		cursor,
		cursorRaw,
		fromBlock,
		toBlock,
		limit: parseLimit(query.get("limit") ?? undefined),
		topic: parseTopic(query.get("topic") ?? undefined),
		namespace: parseFilter(query.get("namespace") ?? undefined, "namespace"),
		name: parseFilter(query.get("name") ?? undefined, "name"),
		owner: parseFilter(query.get("owner") ?? undefined, "owner"),
	};
}

type BnsNameEventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	topic: string;
	namespace: string;
	name: string;
	fqn: string;
	owner: string | null;
	bns_id: string;
	registered_at: string | number | null;
	imported_at: string | number | null;
	renewal_height: string | number | null;
	stx_burn: string | null;
	preordered_by: string | null;
	hashed_salted_fqn_preorder: string | null;
};

function num(value: string | number | null): number | null {
	if (value === null) return null;
	return Number(value);
}

function normalizeNameEventRow(row: BnsNameEventDbRow): BnsNameEventRow {
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: row.block_time.toISOString(),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		topic: row.topic as BnsNameEventTopic,
		namespace: row.namespace,
		name: row.name,
		fqn: row.fqn,
		owner: row.owner,
		bns_id: row.bns_id,
		registered_at: num(row.registered_at),
		imported_at: num(row.imported_at),
		renewal_height: num(row.renewal_height),
		stx_burn: row.stx_burn,
		preordered_by: row.preordered_by,
		hashed_salted_fqn_preorder: row.hashed_salted_fqn_preorder,
	};
}

export type ReadBnsNameEventsParams = {
	after?: { block_height: number; event_index: number };
	fromBlock: number;
	toBlock: number;
	limit: number;
	topic?: BnsNameEventTopic;
	namespace?: string;
	name?: string;
	owner?: string;
	db?: Kysely<Database>;
};

export type BnsNameEventsReader = (
	params: ReadBnsNameEventsParams,
) => Promise<{ events: BnsNameEventRow[]; next_cursor: string | null }>;

export async function readBnsNameEvents(
	params: ReadBnsNameEventsParams,
): Promise<{ events: BnsNameEventRow[]; next_cursor: string | null }> {
	if (params.toBlock < params.fromBlock) {
		return { events: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();
	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`block_height >= ${params.fromBlock}`,
		sql`block_height <= ${params.toBlock}`,
	];
	if (params.topic) predicates.push(sql`topic = ${params.topic}`);
	if (params.namespace) predicates.push(sql`namespace = ${params.namespace}`);
	if (params.name) predicates.push(sql`name = ${params.name}`);
	if (params.owner) predicates.push(sql`owner = ${params.owner}`);
	if (params.after) {
		predicates.push(
			bumpCursor(params.after.block_height, params.after.event_index),
		);
	}

	const { rows } = await sql<BnsNameEventDbRow>`
		SELECT cursor, block_height, block_time, tx_id, tx_index, event_index,
			topic, namespace, name, fqn, owner, bns_id,
			registered_at, imported_at, renewal_height, stx_burn,
			preordered_by, hashed_salted_fqn_preorder
		FROM bns_name_events
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY block_height ASC, event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const pageRows = rows.slice(0, params.limit);
	const events = pageRows.map(normalizeNameEventRow);
	const last = events.at(-1);
	return {
		events,
		next_cursor: last ? `${last.block_height}:${last.event_index}` : null,
	};
}

export async function getBnsNameEventsResponse(opts: {
	query: URLSearchParams;
	tip: { block_height: number };
	read?: BnsNameEventsReader;
}): Promise<{
	events: BnsNameEventRow[];
	next_cursor: string | null;
	tip: { block_height: number };
}> {
	const parsed = parseBnsNameEventsQuery(opts.query, opts.tip);
	const reader = opts.read ?? readBnsNameEvents;
	const result = await reader({
		after: parsed.cursor,
		fromBlock: parsed.fromBlock,
		toBlock: parsed.toBlock,
		limit: parsed.limit,
		topic: parsed.topic,
		namespace: parsed.namespace,
		name: parsed.name,
		owner: parsed.owner,
	});
	return { ...result, tip: opts.tip };
}

// ── /v1/datasets/bns/namespace-events ──────────────────────────────

export type BnsNamespaceEventRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	tx_index: number;
	event_index: number;
	status: BnsNamespaceEventStatus;
	namespace: string;
	manager: string | null;
	manager_frozen: boolean | null;
	manager_transfers_disabled: boolean | null;
	price_function: string | null;
	price_frozen: boolean | null;
	lifetime: number | null;
	revealed_at: number | null;
	launched_at: number | null;
};

export type BnsNamespaceEventsQuery = {
	cursor?: { block_height: number; event_index: number };
	cursorRaw?: string;
	fromBlock: number;
	toBlock: number;
	limit: number;
	status?: BnsNamespaceEventStatus;
	namespace?: string;
};

export function parseBnsNamespaceEventsQuery(
	query: URLSearchParams,
	tip: { block_height: number },
): BnsNamespaceEventsQuery {
	const cursorRaw = query.get("cursor") ?? undefined;
	const fromBlockRaw = query.get("from_block") ?? undefined;
	const toBlockRaw = query.get("to_block") ?? undefined;
	if (cursorRaw && fromBlockRaw !== undefined) {
		throw new ValidationError("cursor and from_block are mutually exclusive");
	}
	const cursor = cursorRaw ? parseCursor(cursorRaw) : undefined;
	const defaultFromBlock = Math.max(
		0,
		tip.block_height - STREAMS_BLOCKS_PER_DAY,
	);
	const fromBlock =
		fromBlockRaw !== undefined
			? parseNonNegativeInteger(fromBlockRaw, "from_block")
			: cursorRaw !== undefined
				? 0
				: defaultFromBlock;
	const toBlock =
		toBlockRaw !== undefined
			? Math.min(
					parseNonNegativeInteger(toBlockRaw, "to_block"),
					tip.block_height,
				)
			: tip.block_height;
	return {
		cursor,
		cursorRaw,
		fromBlock,
		toBlock,
		limit: parseLimit(query.get("limit") ?? undefined),
		status: parseNamespaceStatus(query.get("status") ?? undefined),
		namespace: parseFilter(query.get("namespace") ?? undefined, "namespace"),
	};
}

type BnsNamespaceEventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	status: string;
	namespace: string;
	manager: string | null;
	manager_frozen: boolean | null;
	manager_transfers_disabled: boolean | null;
	price_function: string | null;
	price_frozen: boolean | null;
	lifetime: string | number | null;
	revealed_at: string | number | null;
	launched_at: string | number | null;
};

function normalizeNamespaceEventRow(
	row: BnsNamespaceEventDbRow,
): BnsNamespaceEventRow {
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: row.block_time.toISOString(),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		status: row.status as BnsNamespaceEventStatus,
		namespace: row.namespace,
		manager: row.manager,
		manager_frozen: row.manager_frozen,
		manager_transfers_disabled: row.manager_transfers_disabled,
		price_function: row.price_function,
		price_frozen: row.price_frozen,
		lifetime: num(row.lifetime),
		revealed_at: num(row.revealed_at),
		launched_at: num(row.launched_at),
	};
}

export type ReadBnsNamespaceEventsParams = {
	after?: { block_height: number; event_index: number };
	fromBlock: number;
	toBlock: number;
	limit: number;
	status?: BnsNamespaceEventStatus;
	namespace?: string;
	db?: Kysely<Database>;
};

export type BnsNamespaceEventsReader = (
	params: ReadBnsNamespaceEventsParams,
) => Promise<{ events: BnsNamespaceEventRow[]; next_cursor: string | null }>;

export async function readBnsNamespaceEvents(
	params: ReadBnsNamespaceEventsParams,
): Promise<{ events: BnsNamespaceEventRow[]; next_cursor: string | null }> {
	if (params.toBlock < params.fromBlock) {
		return { events: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();
	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`block_height >= ${params.fromBlock}`,
		sql`block_height <= ${params.toBlock}`,
	];
	if (params.status) predicates.push(sql`status = ${params.status}`);
	if (params.namespace) predicates.push(sql`namespace = ${params.namespace}`);
	if (params.after) {
		predicates.push(
			bumpCursor(params.after.block_height, params.after.event_index),
		);
	}
	const { rows } = await sql<BnsNamespaceEventDbRow>`
		SELECT cursor, block_height, block_time, tx_id, tx_index, event_index,
			status, namespace, manager, manager_frozen, manager_transfers_disabled,
			price_function, price_frozen, lifetime, revealed_at, launched_at
		FROM bns_namespace_events
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY block_height ASC, event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);
	const pageRows = rows.slice(0, params.limit);
	const events = pageRows.map(normalizeNamespaceEventRow);
	const last = events.at(-1);
	return {
		events,
		next_cursor: last ? `${last.block_height}:${last.event_index}` : null,
	};
}

export async function getBnsNamespaceEventsResponse(opts: {
	query: URLSearchParams;
	tip: { block_height: number };
	read?: BnsNamespaceEventsReader;
}): Promise<{
	events: BnsNamespaceEventRow[];
	next_cursor: string | null;
	tip: { block_height: number };
}> {
	const parsed = parseBnsNamespaceEventsQuery(opts.query, opts.tip);
	const reader = opts.read ?? readBnsNamespaceEvents;
	const result = await reader({
		after: parsed.cursor,
		fromBlock: parsed.fromBlock,
		toBlock: parsed.toBlock,
		limit: parsed.limit,
		status: parsed.status,
		namespace: parsed.namespace,
	});
	return { ...result, tip: opts.tip };
}

// ── /v1/datasets/bns/marketplace-events ────────────────────────────

export type BnsMarketplaceEventRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	tx_index: number;
	event_index: number;
	action: BnsMarketplaceAction;
	bns_id: string;
	price_ustx: string | null;
	commission: string | null;
};

export type BnsMarketplaceEventsQuery = {
	cursor?: { block_height: number; event_index: number };
	cursorRaw?: string;
	fromBlock: number;
	toBlock: number;
	limit: number;
	action?: BnsMarketplaceAction;
	bnsId?: string;
};

export function parseBnsMarketplaceEventsQuery(
	query: URLSearchParams,
	tip: { block_height: number },
): BnsMarketplaceEventsQuery {
	const cursorRaw = query.get("cursor") ?? undefined;
	const fromBlockRaw = query.get("from_block") ?? undefined;
	const toBlockRaw = query.get("to_block") ?? undefined;
	if (cursorRaw && fromBlockRaw !== undefined) {
		throw new ValidationError("cursor and from_block are mutually exclusive");
	}
	const cursor = cursorRaw ? parseCursor(cursorRaw) : undefined;
	const defaultFromBlock = Math.max(
		0,
		tip.block_height - STREAMS_BLOCKS_PER_DAY,
	);
	const fromBlock =
		fromBlockRaw !== undefined
			? parseNonNegativeInteger(fromBlockRaw, "from_block")
			: cursorRaw !== undefined
				? 0
				: defaultFromBlock;
	const toBlock =
		toBlockRaw !== undefined
			? Math.min(
					parseNonNegativeInteger(toBlockRaw, "to_block"),
					tip.block_height,
				)
			: tip.block_height;
	return {
		cursor,
		cursorRaw,
		fromBlock,
		toBlock,
		limit: parseLimit(query.get("limit") ?? undefined),
		action: parseMarketplaceAction(query.get("action") ?? undefined),
		bnsId: parseFilter(query.get("bns_id") ?? undefined, "bns_id"),
	};
}

type BnsMarketplaceEventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	action: string;
	bns_id: string;
	price_ustx: string | null;
	commission: string | null;
};

function normalizeMarketplaceEventRow(
	row: BnsMarketplaceEventDbRow,
): BnsMarketplaceEventRow {
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: row.block_time.toISOString(),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		action: row.action as BnsMarketplaceAction,
		bns_id: row.bns_id,
		price_ustx: row.price_ustx,
		commission: row.commission,
	};
}

export type ReadBnsMarketplaceEventsParams = {
	after?: { block_height: number; event_index: number };
	fromBlock: number;
	toBlock: number;
	limit: number;
	action?: BnsMarketplaceAction;
	bnsId?: string;
	db?: Kysely<Database>;
};

export type BnsMarketplaceEventsReader = (
	params: ReadBnsMarketplaceEventsParams,
) => Promise<{ events: BnsMarketplaceEventRow[]; next_cursor: string | null }>;

export async function readBnsMarketplaceEvents(
	params: ReadBnsMarketplaceEventsParams,
): Promise<{ events: BnsMarketplaceEventRow[]; next_cursor: string | null }> {
	if (params.toBlock < params.fromBlock) {
		return { events: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();
	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`block_height >= ${params.fromBlock}`,
		sql`block_height <= ${params.toBlock}`,
	];
	if (params.action) predicates.push(sql`action = ${params.action}`);
	if (params.bnsId) predicates.push(sql`bns_id = ${params.bnsId}`);
	if (params.after) {
		predicates.push(
			bumpCursor(params.after.block_height, params.after.event_index),
		);
	}
	const { rows } = await sql<BnsMarketplaceEventDbRow>`
		SELECT cursor, block_height, block_time, tx_id, tx_index, event_index,
			action, bns_id, price_ustx, commission
		FROM bns_marketplace_events
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY block_height ASC, event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);
	const pageRows = rows.slice(0, params.limit);
	const events = pageRows.map(normalizeMarketplaceEventRow);
	const last = events.at(-1);
	return {
		events,
		next_cursor: last ? `${last.block_height}:${last.event_index}` : null,
	};
}

export async function getBnsMarketplaceEventsResponse(opts: {
	query: URLSearchParams;
	tip: { block_height: number };
	read?: BnsMarketplaceEventsReader;
}): Promise<{
	events: BnsMarketplaceEventRow[];
	next_cursor: string | null;
	tip: { block_height: number };
}> {
	const parsed = parseBnsMarketplaceEventsQuery(opts.query, opts.tip);
	const reader = opts.read ?? readBnsMarketplaceEvents;
	const result = await reader({
		after: parsed.cursor,
		fromBlock: parsed.fromBlock,
		toBlock: parsed.toBlock,
		limit: parsed.limit,
		action: parsed.action,
		bnsId: parsed.bnsId,
	});
	return { ...result, tip: opts.tip };
}

// ── /v1/datasets/bns/names ────────────────────────────────────────

export type BnsNameRow = {
	fqn: string;
	namespace: string;
	name: string;
	owner: string;
	bns_id: string;
	registered_at: number | null;
	renewal_height: number | null;
	last_event_cursor: string;
	last_event_at: string;
};

type BnsNameDbRow = {
	fqn: string;
	namespace: string;
	name: string;
	owner: string;
	bns_id: string;
	registered_at: string | number | null;
	renewal_height: string | number | null;
	last_event_cursor: string;
	last_event_at: Date;
};

function normalizeNameRow(row: BnsNameDbRow): BnsNameRow {
	return {
		fqn: row.fqn,
		namespace: row.namespace,
		name: row.name,
		owner: row.owner,
		bns_id: row.bns_id,
		registered_at: num(row.registered_at),
		renewal_height: num(row.renewal_height),
		last_event_cursor: row.last_event_cursor,
		last_event_at: row.last_event_at.toISOString(),
	};
}

export type BnsNamesPageResult = {
	names: BnsNameRow[];
	next_cursor: string | null;
};

export type BnsNamesReader = (params: {
	namespace?: string;
	owner?: string;
	afterBnsId?: string;
	limit: number;
}) => Promise<BnsNamesPageResult>;

export async function readBnsNames(params: {
	namespace?: string;
	owner?: string;
	afterBnsId?: string;
	limit: number;
	db?: Kysely<Database>;
}): Promise<BnsNamesPageResult> {
	const db = params.db ?? getSourceDb();
	const predicates: RawBuilder<unknown>[] = [];
	if (params.namespace) predicates.push(sql`namespace = ${params.namespace}`);
	if (params.owner) predicates.push(sql`owner = ${params.owner}`);
	if (params.afterBnsId !== undefined) {
		predicates.push(sql`bns_id > ${params.afterBnsId}`);
	}
	const where =
		predicates.length === 0
			? sql``
			: sql`WHERE ${sql.join(predicates, sql` AND `)}`;
	const { rows } = await sql<BnsNameDbRow>`
		SELECT fqn, namespace, name, owner, bns_id,
			registered_at, renewal_height, last_event_cursor, last_event_at
		FROM bns_names
		${where}
		ORDER BY bns_id ASC
		LIMIT ${params.limit + 1}
	`.execute(db);
	const pageRows = rows.slice(0, params.limit);
	const next =
		rows.length > params.limit ? (pageRows.at(-1)?.bns_id ?? null) : null;
	return {
		names: pageRows.map(normalizeNameRow),
		next_cursor: next,
	};
}

// Cursor format: opaque `bns_id` string. Stable because `bns_id` is the
// on-chain mint sequence — strictly monotonic and globally unique.
function parseBnsNamesCursor(value: string): string {
	if (!/^\d+$/.test(value)) {
		throw new ValidationError("cursor must be a numeric bns_id");
	}
	return value;
}

export async function getBnsNamesResponse(opts: {
	query: URLSearchParams;
	readNames?: BnsNamesReader;
}): Promise<BnsNamesPageResult> {
	if (opts.query.get("offset") !== null) {
		throw new ValidationError(
			"offset is not supported; use cursor pagination via ?cursor=<bns_id>",
		);
	}
	const limit = parseLimit(opts.query.get("limit") ?? undefined);
	const namespace = parseFilter(
		opts.query.get("namespace") ?? undefined,
		"namespace",
	);
	const owner = parseFilter(opts.query.get("owner") ?? undefined, "owner");
	const cursorRaw = opts.query.get("cursor") ?? undefined;
	const afterBnsId = cursorRaw ? parseBnsNamesCursor(cursorRaw) : undefined;
	const readNames: BnsNamesReader = opts.readNames ?? readBnsNames;
	return readNames({ namespace, owner, afterBnsId, limit });
}

// ── /v1/datasets/bns/namespaces ───────────────────────────────────

export type BnsNamespaceRow = {
	namespace: string;
	manager: string | null;
	manager_frozen: boolean;
	price_frozen: boolean;
	lifetime: number | null;
	launched_at: number | null;
	last_event_cursor: string;
	last_event_at: string;
	name_count: number;
};

type BnsNamespaceDbRow = {
	namespace: string;
	manager: string | null;
	manager_frozen: boolean;
	price_frozen: boolean;
	lifetime: string | number | null;
	launched_at: string | number | null;
	last_event_cursor: string;
	last_event_at: Date;
	name_count: string | number;
};

function normalizeNamespaceRow(row: BnsNamespaceDbRow): BnsNamespaceRow {
	return {
		namespace: row.namespace,
		manager: row.manager,
		manager_frozen: row.manager_frozen,
		price_frozen: row.price_frozen,
		lifetime: num(row.lifetime),
		launched_at: num(row.launched_at),
		last_event_cursor: row.last_event_cursor,
		last_event_at: row.last_event_at.toISOString(),
		name_count: Number(row.name_count),
	};
}

export async function readBnsNamespaces(params: {
	db?: Kysely<Database>;
}): Promise<{ namespaces: BnsNamespaceRow[] }> {
	const db = params.db ?? getSourceDb();
	const { rows } = await sql<BnsNamespaceDbRow>`
		SELECT namespace, manager, manager_frozen, price_frozen,
			lifetime, launched_at, last_event_cursor, last_event_at, name_count
		FROM bns_namespaces
		ORDER BY namespace
	`.execute(db);
	return { namespaces: rows.map(normalizeNamespaceRow) };
}

export type BnsNamespacesReader = () => Promise<{
	namespaces: BnsNamespaceRow[];
}>;

export type BnsNamespacesResponse =
	| { namespaces: BnsNamespaceRow[] }
	| {
			namespaces: BnsNamespaceRow[];
			status: "backfill_pending";
			earliest_indexed_block: number;
	  };

export async function getBnsNamespacesResponse(opts?: {
	readNamespaces?: BnsNamespacesReader;
	readEarliestIndexedBlock?: BnsEarliestIndexedBlockReader;
}): Promise<BnsNamespacesResponse> {
	const readNamespaces: BnsNamespacesReader =
		opts?.readNamespaces ?? (() => readBnsNamespaces({}));
	const result = await readNamespaces();
	if (result.namespaces.length > 0) return result;
	// Empty projection — disambiguate "no namespace events ever" from "backfill
	// hasn't reached the era when .btc / .id were created." The same
	// `bns_names` earliest cursor signals both: BNS decoder writes both tables
	// in one pass, so the indexed range is identical.
	const readEarliest: BnsEarliestIndexedBlockReader =
		opts?.readEarliestIndexedBlock ??
		(() => readBnsNamesEarliestIndexedBlock({}));
	const earliest = await readEarliest();
	if (earliest !== null && earliest > BNS_BACKFILL_GAP_THRESHOLD_BLOCK) {
		return {
			namespaces: [],
			status: "backfill_pending",
			earliest_indexed_block: earliest,
		};
	}
	return result;
}

// ── /v1/datasets/bns/resolve ──────────────────────────────────────

export async function resolveBnsName(params: {
	fqn: string;
	db?: Kysely<Database>;
}): Promise<BnsNameRow | null> {
	const db = params.db ?? getSourceDb();
	const { rows } = await sql<BnsNameDbRow>`
		SELECT fqn, namespace, name, owner, bns_id,
			registered_at, renewal_height, last_event_cursor, last_event_at
		FROM bns_names
		WHERE fqn = ${params.fqn}
		LIMIT 1
	`.execute(db);
	const first = rows[0];
	return first ? normalizeNameRow(first) : null;
}

// Earliest block_height present in the indexed bns_names projection. Used to
// disambiguate "name does not exist" from "name predates indexed range" — the
// latter happens because backfill currently only covers block 7800000+ on
// prod (older history pending reprocess).
export async function readBnsNamesEarliestIndexedBlock(params: {
	db?: Kysely<Database>;
}): Promise<number | null> {
	const db = params.db ?? getSourceDb();
	const { rows } = await sql<{ earliest: string | number | null }>`
		SELECT MIN(CAST(split_part(last_event_cursor, ':', 1) AS BIGINT)) AS earliest
		FROM bns_names
	`.execute(db);
	return num(rows[0]?.earliest ?? null);
}

// When earliest_indexed_block > this threshold, we know the projection has a
// backfill gap and should return BACKFILL_PENDING rather than 404. BNS-V2 names
// exist from early Stacks history; any earliest above ~1M means coverage is
// truncated.
const BNS_BACKFILL_GAP_THRESHOLD_BLOCK = 1_000_000;

export type BnsResolveResult =
	| { status: "found"; name: BnsNameRow }
	| { status: "not_indexed"; earliest_indexed_block: number }
	| { status: "not_found" };

export type BnsResolveReader = (fqn: string) => Promise<BnsNameRow | null>;
export type BnsEarliestIndexedBlockReader = () => Promise<number | null>;

export async function getBnsResolveResponse(opts: {
	query: URLSearchParams;
	db?: Kysely<Database>;
	resolveName?: BnsResolveReader;
	readEarliestIndexedBlock?: BnsEarliestIndexedBlockReader;
}): Promise<BnsResolveResult> {
	const fqn = opts.query.get("fqn");
	if (!fqn) {
		throw new ValidationError("fqn query parameter is required");
	}
	if (!/^[a-z0-9._-]+$/i.test(fqn) || !fqn.includes(".")) {
		throw new ValidationError("fqn must be of the form name.namespace");
	}
	const resolveName: BnsResolveReader =
		opts.resolveName ?? ((f) => resolveBnsName({ fqn: f, db: opts.db }));
	const readEarliest: BnsEarliestIndexedBlockReader =
		opts.readEarliestIndexedBlock ??
		(() => readBnsNamesEarliestIndexedBlock({ db: opts.db }));
	const name = await resolveName(fqn);
	if (name) return { status: "found", name };
	const earliest = await readEarliest();
	if (earliest !== null && earliest > BNS_BACKFILL_GAP_THRESHOLD_BLOCK) {
		return { status: "not_indexed", earliest_indexed_block: earliest };
	}
	return { status: "not_found" };
}
