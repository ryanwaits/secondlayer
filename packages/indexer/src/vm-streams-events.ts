import {
	VM_EVENT_TYPES,
	type VmEventType,
	encodeStreamsCursor,
} from "@secondlayer/shared";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely, RawBuilder } from "kysely";
import type {
	ReadCanonicalStreamsEventsParams,
	ReadCanonicalStreamsEventsResult,
	VmStreamsEvent,
} from "./streams-events.ts";

const VM_TYPE_SET = new Set<string>(VM_EVENT_TYPES);

type VmRow = {
	block_height: string | number;
	block_hash: string;
	burn_block_height: string | number;
	tx_id: string;
	tx_index: string | number;
	vm_event_index: string | number;
	event_type: VmEventType;
	contract_id: string | null;
	payload: unknown;
	ts: Date | string | null;
};

/** Streams clock=vm: filter-invariant over vm_events.vm_event_index. */
export async function readCanonicalVmEvents(
	params: ReadCanonicalStreamsEventsParams,
): Promise<ReadCanonicalStreamsEventsResult> {
	const db = params.db ?? getSourceDb();
	const notTypes = new Set<string>(params.notTypes ?? []);
	const types = (params.types ?? VM_EVENT_TYPES).filter(
		(t) => VM_TYPE_SET.has(t) && !notTypes.has(t),
	) as VmEventType[];
	if (types.length === 0) return { events: [], next_cursor: null };

	const predicates: RawBuilder<unknown>[] = [
		sql`b.canonical = true`,
		sql`vm.block_height <= ${params.toHeight}`,
		sql`vm.type IN (${sql.join(
			types.map((t) => sql`${t}`),
			sql`, `,
		)})`,
	];
	if (params.fromHeight !== undefined) {
		predicates.push(sql`vm.block_height >= ${params.fromHeight}`);
	}
	if (params.after) {
		predicates.push(
			sql`(vm.block_height, vm.vm_event_index) > (${params.after.block_height}, ${params.after.event_index})`,
		);
	}
	if (params.contractId) {
		const ids = Array.isArray(params.contractId)
			? params.contractId
			: [params.contractId];
		predicates.push(
			sql`vm.data->>'contract_identifier' IN (${sql.join(
				ids.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);
	}

	const { rows } = await sql<VmRow>`
		SELECT
			vm.block_height,
			b.hash AS block_hash,
			b.burn_block_height,
			vm.tx_id,
			COALESCE(t.tx_index, 0) AS tx_index,
			vm.vm_event_index,
			vm.type AS event_type,
			vm.data->>'contract_identifier' AS contract_id,
			vm.data AS payload,
			to_timestamp(b.timestamp) AT TIME ZONE 'UTC' AS ts
		FROM vm_events vm
		INNER JOIN blocks b ON b.height = vm.block_height
		LEFT JOIN transactions t ON t.tx_id = vm.tx_id
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY vm.block_height ASC, vm.vm_event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const page = rows.slice(0, params.limit);
	const last = page.at(-1);
	const events: VmStreamsEvent[] = page.map((row) => {
		const eventIndex = Number(row.vm_event_index);
		const height = Number(row.block_height);
		return {
			cursor: encodeStreamsCursor({
				block_height: height,
				event_index: eventIndex,
			}),
			block_height: height,
			block_hash: row.block_hash,
			burn_block_height: Number(row.burn_block_height),
			tx_id: row.tx_id,
			tx_index: Number(row.tx_index),
			event_index: eventIndex,
			event_type: row.event_type,
			contract_id: row.contract_id,
			payload:
				row.payload && typeof row.payload === "object"
					? (row.payload as Record<string, unknown>)
					: {},
			ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts ?? ""),
			canonical: true,
		};
	});

	return {
		events,
		next_cursor: last
			? encodeStreamsCursor({
					block_height: Number(last.block_height),
					event_index: Number(last.vm_event_index),
				})
			: null,
	};
}

export type { Kysely, Database };
