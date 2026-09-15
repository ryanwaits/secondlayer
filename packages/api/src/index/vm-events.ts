import { VM_EVENT_TYPES, type VmEventType } from "@secondlayer/shared";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { resolveTraitContractIds } from "@secondlayer/shared/db/queries/contracts";
import type { RawBuilder } from "kysely";
import { encodeIndexCursor, toIsoOrNull } from "./_shared.ts";
import type {
	IndexEvent,
	IndexEventConfig,
	ReadIndexEventsParams,
	ReadIndexEventsResult,
} from "./events.ts";

const PAGINATION_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
] as const;

const VM_COMMON = [...PAGINATION_FILTERS, "contract_id", "tx_id"] as const;

/** Filter keys on GET /v1/index/events for vm types. `map` is map_name. */
export type VmIndexEqualityFilter =
	| "contract_id"
	| "function_name"
	| "map"
	| "var_name"
	| "sender"
	| "caller"
	| "tx_id";

export const VM_INDEX_EVENT_CONFIG = {
	nested_contract_call: {
		columns: [
			"sender",
			"caller",
			"function_name",
			"function_args",
			"raw_result",
		],
		requiredNonNull: ["contract_id", "caller", "function_name"],
		// Every allowed filter must also be an equality filter: the parser only
		// collects equalityFilters, so an allowed-but-not-equality key is accepted
		// and silently ignored (returns the unfiltered feed).
		equalityFilters: [
			"contract_id",
			"function_name",
			"caller",
			"sender",
			"tx_id",
		] as const satisfies readonly VmIndexEqualityFilter[],
		allowedFilters: [...VM_COMMON, "function_name", "caller", "sender"],
	},
	var_set: {
		columns: ["var_name", "raw_value"],
		requiredNonNull: ["contract_id", "var_name"],
		equalityFilters: [
			"contract_id",
			"var_name",
			"tx_id",
		] as const satisfies readonly VmIndexEqualityFilter[],
		allowedFilters: [...VM_COMMON, "var_name"],
	},
	map_set: {
		columns: ["map", "raw_key", "raw_value"],
		requiredNonNull: ["contract_id", "map"],
		equalityFilters: [
			"contract_id",
			"map",
			"tx_id",
		] as const satisfies readonly VmIndexEqualityFilter[],
		allowedFilters: [...VM_COMMON, "map"],
	},
	map_insert: {
		columns: ["map", "raw_key", "raw_value"],
		requiredNonNull: ["contract_id", "map"],
		equalityFilters: [
			"contract_id",
			"map",
			"tx_id",
		] as const satisfies readonly VmIndexEqualityFilter[],
		allowedFilters: [...VM_COMMON, "map"],
	},
	map_delete: {
		columns: ["map", "raw_key"],
		requiredNonNull: ["contract_id", "map"],
		equalityFilters: [
			"contract_id",
			"map",
			"tx_id",
		] as const satisfies readonly VmIndexEqualityFilter[],
		allowedFilters: [...VM_COMMON, "map"],
	},
} as const satisfies Record<VmEventType, IndexEventConfig>;

export const VM_INDEX_EVENT_TYPES = [...VM_EVENT_TYPES];

export function isVmIndexEventType(value: string): value is VmEventType {
	return (VM_EVENT_TYPES as readonly string[]).includes(value);
}

const FILTER_EXPR: Record<VmIndexEqualityFilter, RawBuilder<unknown>> = {
	contract_id: sql`vm.data->>'contract_identifier'`,
	function_name: sql`vm.data->>'function_name'`,
	map: sql`vm.data->>'map_name'`,
	var_name: sql`vm.data->>'var_name'`,
	sender: sql`vm.data->>'sender'`,
	caller: sql`vm.data->>'caller'`,
	tx_id: sql`vm.tx_id`,
};

const COLUMN_EXPR: Record<string, RawBuilder<unknown>> = {
	sender: sql`vm.data->>'sender' AS sender`,
	caller: sql`vm.data->>'caller' AS caller`,
	function_name: sql`vm.data->>'function_name' AS function_name`,
	function_args: sql`vm.data->'function_args' AS function_args`,
	raw_result: sql`vm.data->>'raw_result' AS raw_result`,
	map: sql`vm.data->>'map_name' AS map`,
	var_name: sql`vm.data->>'var_name' AS var_name`,
	raw_key: sql`vm.data->>'raw_key' AS raw_key`,
	raw_value: sql`vm.data->>'raw_value' AS raw_value`,
};

type VmIndexRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date | string | null;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	event_type: VmEventType;
	contract_id: string | null;
	sender?: string | null;
	caller?: string | null;
	function_name?: string | null;
	function_args?: unknown;
	raw_result?: string | null;
	map?: string | null;
	var_name?: string | null;
	raw_key?: string | null;
	raw_value?: string | null;
	tx_sender?: string | null;
	tx_type?: string | null;
	tx_status?: string | null;
	tx_contract_id?: string | null;
	tx_function_name?: string | null;
};

function normalizeVmRow(
	row: VmIndexRow,
	config: IndexEventConfig,
	fields?: ReadonlySet<string>,
): IndexEvent {
	const event: IndexEvent = {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: toIsoOrNull(row.block_time),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		event_type: row.event_type,
		contract_id: row.contract_id,
	};
	for (const column of config.columns) {
		(event as Record<string, unknown>)[column] = (
			row as Record<string, unknown>
		)[column];
	}
	if (fields) {
		const always = new Set(["cursor", "block_height", "event_type"]);
		for (const key of Object.keys(event)) {
			if (!always.has(key) && !fields.has(key)) {
				delete (event as Record<string, unknown>)[key];
			}
		}
	}
	if (row.tx_sender !== undefined) {
		event.tx_sender = row.tx_sender;
		event.tx_type = row.tx_type;
		event.tx_status = row.tx_status;
		event.tx_contract_id = row.tx_contract_id;
		event.tx_function_name = row.tx_function_name;
	}
	return event;
}

/** Index read over vm_events. Cursor second component is vm_event_index. */
export async function readVmIndexEvents(
	params: ReadIndexEventsParams,
): Promise<ReadIndexEventsResult> {
	if (params.toHeight < params.fromHeight) {
		return { events: [], next_cursor: null };
	}
	if (!isVmIndexEventType(params.eventType)) {
		return { events: [], next_cursor: null };
	}

	const config = VM_INDEX_EVENT_CONFIG[params.eventType];
	const db = params.db ?? getSourceDb();
	const filters = params.filters ?? {};

	const predicates: RawBuilder<unknown>[] = [
		sql`b.canonical = true`,
		sql`vm.type = ${params.eventType}`,
		sql`vm.block_height >= ${params.fromHeight}`,
		sql`vm.block_height <= ${params.toHeight}`,
		// Parity with the classic reader: the rows this event_type guarantees.
		// A malformed `data` (no contract_identifier) never reaches a page.
		...config.requiredNonNull.map(
			(column) =>
				sql`${FILTER_EXPR[column as VmIndexEqualityFilter]} IS NOT NULL`,
		),
	];

	if (params.after) {
		predicates.push(
			sql`(vm.block_height, vm.vm_event_index) > (${params.after.block_height}, ${params.after.event_index})`,
		);
	}

	for (const filter of config.equalityFilters) {
		const value = filters[filter as keyof typeof filters];
		if (value) {
			const expr = FILTER_EXPR[filter as VmIndexEqualityFilter];
			if (expr) predicates.push(sql`${expr} = ${value}`);
		}
	}

	if (params.contractIds && params.contractIds.length > 0) {
		predicates.push(
			sql`vm.data->>'contract_identifier' IN (${sql.join(
				params.contractIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);
	}

	if (params.trait) {
		const ids = await resolveTraitContractIds(
			db,
			params.trait,
			params.toHeight,
		);
		if (ids.length === 0) return { events: [], next_cursor: null };
		predicates.push(
			sql`vm.data->>'contract_identifier' IN (${sql.join(
				ids.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);
	}

	const wanted = params.fields ? new Set(params.fields) : undefined;
	const selectedColumns = wanted
		? config.columns.filter((column) => wanted.has(column))
		: [...config.columns];
	const extraColumns =
		selectedColumns.length > 0
			? sql`, ${sql.join(
					selectedColumns.map((column) => COLUMN_EXPR[column]),
					sql`, `,
				)}`
			: sql``;

	const needsBlockTime = !wanted || wanted.has("block_time");
	const blockTimeSelect = needsBlockTime
		? sql`, to_timestamp(b.timestamp) AT TIME ZONE 'UTC' AS block_time`
		: sql``;

	const txSelect = params.withTx
		? sql`, t.sender AS tx_sender, t.type AS tx_type, t.status AS tx_status, t.contract_id AS tx_contract_id, t.function_name AS tx_function_name`
		: sql``;

	const { rows } = await sql<VmIndexRow>`
		SELECT
			vm.block_height::text || ':' || vm.vm_event_index::text AS cursor,
			vm.block_height,
			vm.vm_event_index AS event_index,
			vm.type AS event_type,
			vm.tx_id,
			COALESCE(t.tx_index, 0) AS tx_index,
			vm.data->>'contract_identifier' AS contract_id
			${blockTimeSelect}${extraColumns}${txSelect}
		FROM vm_events vm
		INNER JOIN blocks b
			ON b.height = vm.block_height
		LEFT JOIN transactions t
			ON t.tx_id = vm.tx_id
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY vm.block_height ASC, vm.vm_event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const pageRows = rows.slice(0, params.limit);
	const firstRow = pageRows.at(0);
	const lastRow = pageRows.at(-1);
	const span =
		firstRow && lastRow
			? {
					from: {
						block_height: Number(firstRow.block_height),
						event_index: Number(firstRow.event_index),
					},
					to: {
						block_height: Number(lastRow.block_height),
						event_index: Number(lastRow.event_index),
					},
				}
			: undefined;

	return {
		events: pageRows.map((row) => normalizeVmRow(row, config, wanted)),
		next_cursor: lastRow
			? encodeIndexCursor({
					block_height: Number(lastRow.block_height),
					event_index: Number(lastRow.event_index),
				})
			: null,
		span,
	};
}
