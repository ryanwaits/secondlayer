import { camelizeKeys } from "../print-schema.ts";
import { applyMaterializeInsert } from "../runtime/materialize.ts";
import type { MaterializeSpec, SubgraphSchema } from "../types.ts";
import { buildEvent, createTestContext } from "./harness.ts";

/**
 * Shared subgraph test run — payload map + in-memory handlers + fail-closed
 * EMPTY_MAPPING. CLI and MCP both call this; cassette/fetch/print stay in the
 * CLI, Index fetch stays in each caller.
 */

/** Structural Index event row (avoids an SDK dep on this package). */
export interface IndexEventRow {
	event_type: string;
	contract_id?: string | null;
	/** Print events carry `{ topic, value }`; other types vary. */
	payload?: unknown;
	sender?: unknown;
	recipient?: unknown;
	amount?: unknown;
	asset_identifier?: unknown;
	value?: unknown;
	cursor?: string;
	[key: string]: unknown;
}

/** Structural Index contract-call row. */
export interface IndexContractCallRow {
	sender: string;
	contract_id?: string | null;
	function_name?: string | null;
	args?: unknown;
	result?: unknown;
	result_hex?: unknown;
	tx_id: string;
	status: string;
	cursor?: string;
	[key: string]: unknown;
}

export type IndexTestRow = IndexEventRow | IndexContractCallRow;

export interface SubgraphTestSource {
	type: string;
	contractId?: string | string[];
	topic?: string;
	functionName?: string;
}

/** Per-event IN/OUT trace for `subgraphs preview`. */
export interface EventTrace {
	source: string;
	blockHeight?: number;
	txId?: string;
	/** Camelized event.data keys (or contract-call field names). */
	inKeys: string[];
	/** Tables written by this event; empty when the mapping wrote nothing. */
	outs: Array<{ table: string; keys: string[] }>;
}

export interface SubgraphTestResult {
	ok: boolean;
	code?: "EMPTY_MAPPING" | "NO_EVENTS" | "NO_SOURCES";
	matched: number;
	written: number;
	tables: Array<{
		name: string;
		rows: number;
		sampleRow?: Record<string, unknown>;
	}>;
	firstEvent?: { source: string; data?: unknown };
	hint?: string;
	/** Present when `trace: true`. */
	traces?: EventTrace[];
	/** Keys present on every matched IN and never written to any OUT column. */
	unusedInKeys?: string[];
}

export interface RunSubgraphTestInput {
	schema: SubgraphSchema;
	handlers: Record<string, unknown>;
	sources: Record<string, SubgraphTestSource>;
	events: Record<string, IndexTestRow[]>;
	/** Collect per-event IN/OUT traces (preview). */
	trace?: boolean;
}

/** Map an Index event row onto the payload shape a handler expects. */
export function toHandlerPayload(
	_filter: { type: string } | undefined,
	row: IndexEventRow,
): Record<string, unknown> {
	if (row.event_type === "print") {
		const payload = row.payload as { topic?: string | null; value?: unknown };
		return {
			contractId: row.contract_id ?? "",
			topic: payload?.topic ?? "",
			data: (camelizeKeys(payload?.value) as Record<string, unknown>) ?? {},
		};
	}
	// Token/STX events: the Index row is already flat and camel-free; map the
	// snake_case wire names onto the handler payload names.
	const r = row as Record<string, unknown>;
	return {
		...(r.sender !== undefined ? { sender: r.sender } : {}),
		...(r.recipient !== undefined ? { recipient: r.recipient } : {}),
		...(r.amount !== undefined ? { amount: BigInt(String(r.amount)) } : {}),
		...(r.asset_identifier !== undefined
			? { assetIdentifier: r.asset_identifier }
			: {}),
		...(r.value !== undefined ? { tokenId: r.value } : {}),
	};
}

/** Map an Index contract-call row onto the ContractCallEvent handler shape. */
export function toContractCallPayload(
	row: IndexContractCallRow,
): Record<string, unknown> {
	return {
		type: "contract_call",
		sender: row.sender,
		contractId: row.contract_id ?? "",
		functionName: row.function_name ?? "",
		args: Array.isArray(row.args) ? row.args : [],
		result: row.result ?? null,
		resultHex: row.result_hex ?? null,
		tx: {
			txId: row.tx_id,
			sender: row.sender,
			type: "contract_call",
			status: row.status,
			contractId: row.contract_id ?? null,
			functionName: row.function_name ?? null,
		},
	};
}

function jsonSafe(value: unknown): unknown {
	if (typeof value === "bigint") return value.toString();
	if (value === null || value === undefined) return value;
	if (Array.isArray(value)) return value.map(jsonSafe);
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = jsonSafe(v);
		}
		return out;
	}
	return value;
}

function dataKeysOf(data: unknown): string[] {
	if (data && typeof data === "object" && !Array.isArray(data)) {
		return Object.keys(data as Record<string, unknown>);
	}
	return [];
}

function rowMeta(row: IndexTestRow): {
	blockHeight?: number;
	txId?: string;
} {
	const r = row as Record<string, unknown>;
	return {
		...(typeof r.block_height === "number"
			? { blockHeight: r.block_height }
			: {}),
		...(typeof r.tx_id === "string" ? { txId: r.tx_id } : {}),
	};
}

function inKeysOf(
	filter: SubgraphTestSource | undefined,
	payload: Record<string, unknown>,
): string[] {
	if (filter?.type === "contract_call") {
		return ["functionName", "args", "sender", "contractId"].filter(
			(k) => payload[k] !== undefined,
		);
	}
	return dataKeysOf(payload.data);
}

function unusedInKeysAcross(traces: EventTrace[]): string[] | undefined {
	if (traces.length === 0) return undefined;
	const alwaysIn = new Set(traces[0]?.inKeys ?? []);
	for (const t of traces.slice(1)) {
		const keys = new Set(t.inKeys);
		for (const k of [...alwaysIn]) {
			if (!keys.has(k)) alwaysIn.delete(k);
		}
	}
	const outKeys = new Set<string>();
	for (const t of traces) {
		for (const o of t.outs) {
			for (const k of o.keys) outKeys.add(k);
		}
	}
	// Compare camel IN keys to snake OUT columns loosely: tokenX ↔ token_x.
	const outNormalized = new Set(
		[...outKeys].map((k) => k.replace(/_/g, "").toLowerCase()),
	);
	const unused = [...alwaysIn].filter(
		(k) => !outNormalized.has(k.replace(/_/g, "").toLowerCase()),
	);
	return unused.length > 0 ? unused : undefined;
}

/**
 * Apply local handlers to Index rows in memory. Fail-closed: matched events
 * with zero written rows is EMPTY_MAPPING (the bns-names field-mapping shape).
 */
export async function runSubgraphTest(
	input: RunSubgraphTestInput,
): Promise<SubgraphTestResult> {
	const { schema, handlers, sources, events, trace } = input;
	const sourceNames = Object.keys(sources);
	if (sourceNames.length === 0) {
		return {
			ok: false,
			code: "NO_SOURCES",
			matched: 0,
			written: 0,
			tables: [],
			hint: "No sources to test.",
		};
	}

	const ctx = createTestContext(schema);
	let matched = 0;
	let firstEvent: SubgraphTestResult["firstEvent"];
	const traces: EventTrace[] = [];

	for (const [name, rows] of Object.entries(events)) {
		const filter = sources[name];
		const handler = handlers[name] ?? handlers["*"];
		const materialize =
			filter && "materialize" in filter && filter.materialize !== undefined
				? (filter.materialize as MaterializeSpec)
				: undefined;
		if (typeof handler !== "function" && !materialize) continue;

		for (const row of rows) {
			const payload =
				filter?.type === "contract_call"
					? toContractCallPayload(row as IndexContractCallRow)
					: toHandlerPayload(filter, row as IndexEventRow);
			if (
				filter?.type === "print_event" &&
				filter.topic &&
				(payload as { topic?: string }).topic !== filter.topic
			) {
				continue;
			}
			if (!firstEvent) {
				firstEvent = {
					source: name,
					data:
						filter?.type === "contract_call"
							? {
									functionName: (payload as { functionName?: string })
										.functionName,
									args: (payload as { args?: unknown }).args,
								}
							: (payload as { data?: unknown }).data,
				};
			}
			matched++;
			const checkpoint = ctx.opsCheckpoint();
			try {
				const event = buildEvent(
					filter as Parameters<typeof buildEvent>[0],
					payload as Record<string, unknown>,
				);
				if (materialize) {
					applyMaterializeInsert(
						materialize,
						event as unknown as Record<string, unknown>,
						{
							tx: ctx.tx,
							block: ctx.block,
							insert: (table, insertRow) => {
								ctx.insert(table as never, insertRow as never);
							},
						},
						schema,
					);
				} else {
					await (handler as (e: unknown, c: unknown) => unknown)(event, ctx);
				}
			} catch {
				// Counted as matched; rows may still be empty → EMPTY_MAPPING.
			}
			if (trace) {
				const inserts = ctx.pendingInsertsSince(checkpoint);
				traces.push({
					source: name,
					...rowMeta(row),
					inKeys: inKeysOf(filter, payload),
					outs: inserts.map((i) => ({ table: i.table, keys: i.keys })),
				});
			}
		}
	}

	const tableNames = Object.keys(schema);
	const tables: SubgraphTestResult["tables"] = [];
	let written = 0;
	for (const table of tableNames) {
		const tableRows = await ctx.rows(table as never);
		written += tableRows.length;
		const sample = tableRows[0];
		tables.push({
			name: table,
			rows: tableRows.length,
			...(sample
				? { sampleRow: jsonSafe(sample) as Record<string, unknown> }
				: {}),
		});
	}

	const fetched = Object.values(events).reduce((n, r) => n + r.length, 0);
	const unusedInKeys = trace ? unusedInKeysAcross(traces) : undefined;
	const traceFields = {
		...(trace ? { traces } : {}),
		...(unusedInKeys ? { unusedInKeys } : {}),
	};

	if (fetched === 0) {
		return {
			ok: false,
			code: "NO_EVENTS",
			matched: 0,
			written,
			tables,
			hint: "No events matched these sources in the given range. Widen the range or check the source filters.",
			...traceFields,
		};
	}

	if (written === 0) {
		const keys = dataKeysOf(firstEvent?.data);
		const keyPart =
			keys.length > 0
				? ` Observed event.data keys on first event (${firstEvent?.source}): ${keys.join(", ")}.`
				: firstEvent
					? ` First event source: ${firstEvent.source}.`
					: "";
		return {
			ok: false,
			code: "EMPTY_MAPPING",
			matched,
			written: 0,
			tables,
			firstEvent: firstEvent
				? { ...firstEvent, data: jsonSafe(firstEvent.data) }
				: undefined,
			hint: `${matched} event${matched === 1 ? "" : "s"} matched, but NO rows were written — the shape of the field-mapping bug that ships a 0-row subgraph.${keyPart} Map only observed keys; do not invent fields.`,
			...traceFields,
		};
	}

	// Preview fail-closed: any matched event with 0 OUT rows is EMPTY_MAPPING
	// even when other events wrote (per-event empty mapping).
	if (trace && traces.some((t) => t.outs.length === 0)) {
		const empty = traces.find((t) => t.outs.length === 0);
		const keyPart =
			empty && empty.inKeys.length > 0
				? ` Empty event (${empty.source}) IN keys: ${empty.inKeys.join(", ")}.`
				: "";
		return {
			ok: false,
			code: "EMPTY_MAPPING",
			matched,
			written,
			tables,
			firstEvent: firstEvent
				? { ...firstEvent, data: jsonSafe(firstEvent.data) }
				: undefined,
			hint: `At least one matched event wrote 0 rows.${keyPart}`,
			...traceFields,
		};
	}

	return {
		ok: true,
		matched,
		written,
		tables,
		firstEvent: firstEvent
			? { ...firstEvent, data: jsonSafe(firstEvent.data) }
			: undefined,
		...traceFields,
	};
}

export interface ProbeHandlersDef {
	schema: SubgraphSchema;
	sources: Record<string, { type: string; [key: string]: unknown }>;
	handlers: Record<string, unknown>;
}

export interface ProbeHandlersResult {
	matched: number;
	written: number;
	tables: string[];
	firstEventKeys?: string[];
}

/**
 * Run handlers against pre-built sample payloads in memory (no Index, no
 * Postgres). Deploy uses this with print-schema dummy events to refuse
 * EMPTY_MAPPING before DDL apply.
 */
export async function probeHandlers(
	def: ProbeHandlersDef,
	samples: Array<{ source: string; event: Record<string, unknown> }>,
): Promise<ProbeHandlersResult> {
	const ctx = createTestContext(def.schema);
	let matched = 0;
	let firstEventKeys: string[] | undefined;

	for (const sample of samples) {
		const filter = def.sources[sample.source];
		if (!filter) continue;
		const handler = def.handlers[sample.source] ?? def.handlers["*"];
		const materialize =
			"materialize" in filter && filter.materialize !== undefined
				? (filter.materialize as MaterializeSpec)
				: undefined;
		if (typeof handler !== "function" && !materialize) continue;

		if (firstEventKeys === undefined) {
			firstEventKeys = dataKeysOf(sample.event.data);
		}

		matched++;
		try {
			const event = buildEvent(
				filter as Parameters<typeof buildEvent>[0],
				sample.event,
			);
			if (materialize) {
				applyMaterializeInsert(
					materialize,
					event as unknown as Record<string, unknown>,
					{
						tx: ctx.tx,
						block: ctx.block,
						insert: (table, row) => {
							ctx.insert(table as never, row as never);
						},
					},
					def.schema,
				);
			} else {
				await (handler as (e: unknown, c: unknown) => unknown)(event, ctx);
			}
		} catch {
			// Counted as matched; rows may still be empty → EMPTY_MAPPING.
		}
	}

	const tables = Object.keys(def.schema);
	let written = 0;
	for (const table of tables) {
		written += (await ctx.rows(table as never)).length;
	}

	return {
		matched,
		written,
		tables,
		...(firstEventKeys !== undefined ? { firstEventKeys } : {}),
	};
}
