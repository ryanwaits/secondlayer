import type {
	MaterializeColumn,
	MaterializeSpec,
	SubgraphColumn,
	SubgraphSchema,
} from "../types.ts";
import type { BlockMeta, TxMeta } from "./context.ts";

export type MaterializeBuildResult =
	| { ok: true; row: Record<string, unknown> }
	| { ok: false; reason: string };

function resolveColumn(
	col: MaterializeColumn,
	event: Record<string, unknown>,
	tx: TxMeta,
	block: BlockMeta,
): { ok: true; value: unknown } | { ok: false; missing: string } {
	if ("fromTx" in col) {
		return { ok: true, value: tx[col.fromTx] };
	}
	if ("fromBlock" in col) {
		return { ok: true, value: block[col.fromBlock] };
	}
	const data = event.data;
	const dataObj =
		data !== null && typeof data === "object" && !Array.isArray(data)
			? (data as Record<string, unknown>)
			: undefined;
	if (dataObj && Object.prototype.hasOwnProperty.call(dataObj, col.from)) {
		return { ok: true, value: dataObj[col.from] };
	}
	// `topic` is a native print payload field, not always in `data`.
	if (col.from === "topic" && "topic" in event) {
		return { ok: true, value: event.topic };
	}
	// Native FT/STX-style top-level fields (and any other payload keys).
	if (Object.prototype.hasOwnProperty.call(event, col.from)) {
		return { ok: true, value: event[col.from] };
	}
	return { ok: false, missing: col.from };
}

/**
 * Build an insert row from a static materialize spec. Missing optional
 * columns become null; missing required columns → skip (caller logs).
 */
export function buildMaterializeRow(
	spec: MaterializeSpec,
	event: Record<string, unknown>,
	ctx: { tx: TxMeta; block: BlockMeta },
	tableColumns: Record<string, SubgraphColumn>,
): MaterializeBuildResult {
	const row: Record<string, unknown> = {};
	for (const [colName, mapping] of Object.entries(spec.columns)) {
		const resolved = resolveColumn(mapping, event, ctx.tx, ctx.block);
		if (!resolved.ok) {
			const colDef = tableColumns[colName];
			if (colDef?.nullable) {
				row[colName] = null;
				continue;
			}
			return {
				ok: false,
				reason: `required materialize field "${resolved.missing}" missing for column "${colName}"`,
			};
		}
		row[colName] = resolved.value ?? null;
	}
	return { ok: true, row };
}

/** Apply materialize insert when the source has a spec; returns skip reason. */
export function applyMaterializeInsert(
	spec: MaterializeSpec,
	event: Record<string, unknown>,
	ctx: {
		tx: TxMeta;
		block: BlockMeta;
		insert: (table: string, row: Record<string, unknown>) => void;
	},
	schema: SubgraphSchema,
): { ok: true } | { ok: false; reason: string } {
	const table = schema[spec.table];
	if (!table) {
		return { ok: false, reason: `materialize table "${spec.table}" missing` };
	}
	const built = buildMaterializeRow(spec, event, ctx, table.columns);
	if (!built.ok) return built;
	ctx.insert(spec.table, built.row);
	return { ok: true };
}
