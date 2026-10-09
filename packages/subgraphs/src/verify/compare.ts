/**
 * Replayed rows against served rows, per table, over the replay window.
 *
 * Both sides go through one canonical form, so a difference is a value
 * difference, never a Postgres-vs-memory representation one: `_id` and
 * `_created_at` are dropped, numbers become decimal strings, timestamps epoch
 * milliseconds, jsonb sorted-key JSON with bigints as decimal strings.
 */
import { createHash } from "node:crypto";
import type { SubgraphSchema, SubgraphTable } from "../types.ts";
import type { ReplayFailure } from "./replay.ts";

type Row = Record<string, unknown>;

export interface TableComparison {
	table: string;
	/** Replayed rows the served table holds identically. */
	equal: number;
	/** Replayed keys the served table re-created after `to`: not checked. */
	superseded: number;
	/** sha256 over the sorted canonical replayed rows in the window, hex. */
	digest: string;
	/** The same digest over the served rows in the window. */
	servedDigest: string;
}

export interface RowComparison {
	failures: ReplayFailure[];
	tables: TableComparison[];
}

/** RFC 8785-style JSON: sorted keys, bigints as decimal strings. */
function canonicalJson(value: unknown): unknown {
	if (typeof value === "bigint") return value.toString();
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (value && typeof value === "object" && !(value instanceof Date)) {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(value).sort()) {
			out[k] = canonicalJson((value as Record<string, unknown>)[k]);
		}
		return out;
	}
	return value ?? null;
}

function canonicalValue(type: string | undefined, value: unknown): unknown {
	if (value === undefined || value === null) return null;
	switch (type) {
		case "uint":
		case "int":
			return typeof value === "string"
				? BigInt(value).toString()
				: String(value);
		case "boolean":
			return value === true || value === "true" || value === "t"
				? "true"
				: "false";
		case "timestamp": {
			// Postgres hands back a Date; the memory store keeps what the handler
			// wrote (a string the flush would have cast).
			const ms =
				value instanceof Date
					? value.getTime()
					: typeof value === "number"
						? value
						: Date.parse(String(value));
			return String(ms);
		}
		case "jsonb":
			return JSON.stringify(
				canonicalJson(typeof value === "string" ? JSON.parse(value) : value),
			);
		default:
			return value instanceof Uint8Array
				? Buffer.from(value).toString("hex")
				: String(value);
	}
}

/** Declared columns + `_block_height` + `_tx_id`, in a fixed order. */
function canonicalRow(
	def: SubgraphTable,
	row: Row,
	columns: string[] = Object.keys(def.columns).sort(),
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const c of columns)
		out[c] = canonicalValue(def.columns[c]?.type, row[c]);
	out._block_height = canonicalValue("uint", row._block_height);
	out._tx_id = row._tx_id == null ? null : String(row._tx_id);
	return out;
}

const line = (r: Record<string, unknown>) => JSON.stringify(r);

function digest(lines: string[]): string {
	return createHash("sha256")
		.update([...lines].sort().join("\n"))
		.digest("hex");
}

const heightOf = (row: Row) => Number(row._block_height);

function firstDifference(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): string | undefined {
	return Object.keys(a).find((k) => a[k] !== b[k]);
}

/**
 * Compare the replayed tables with the served ones over `[from, to]` on
 * `_block_height`. Keyed tables (first `uniqueKeys` tuple) compare row by
 * row; unkeyed tables as multisets.
 */
export function compareRows(
	schema: SubgraphSchema,
	replayed: {
		from: number;
		to: number;
		tables: Map<string, Row[]>;
	},
	served: Map<string, Row[]>,
): RowComparison {
	const { from, to } = replayed;
	const inWindow = (row: Row) => heightOf(row) >= from && heightOf(row) <= to;
	const failures: ReplayFailure[] = [];
	const tables: TableComparison[] = [];
	const fail = (table: string, message: string, key?: Row) =>
		failures.push({
			step: "rows",
			table,
			message: `${table} ${message}`,
			...(key ? { key } : {}),
		});

	for (const [table, def] of Object.entries(schema)) {
		const mine = (replayed.tables.get(table) ?? []).filter(inWindow);
		const theirs = served.get(table) ?? [];
		const theirsInWindow = theirs.filter(inWindow);
		const mineLines = mine.map((r) => line(canonicalRow(def, r)));
		const theirLines = theirsInWindow.map((r) => line(canonicalRow(def, r)));
		const summary: TableComparison = {
			table,
			equal: 0,
			superseded: 0,
			digest: digest(mineLines),
			servedDigest: digest(theirLines),
		};
		tables.push(summary);

		const keyCols = def.uniqueKeys?.[0];
		if (!keyCols?.length) {
			// Multiset: count each canonical line on both sides.
			const counts = new Map<string, number>();
			for (const l of mineLines) counts.set(l, (counts.get(l) ?? 0) + 1);
			for (const l of theirLines) counts.set(l, (counts.get(l) ?? 0) - 1);
			const diff = [...counts].find(([, n]) => n !== 0);
			if (diff) {
				const [l, n] = diff;
				const at = JSON.parse(l) as { _block_height: string; _tx_id: string };
				fail(
					table,
					`row at (${at._block_height}, ${at._tx_id}): ${
						n > 0
							? "replayed but not served"
							: "served but no proven input produces it"
					}`,
				);
			} else summary.equal = mine.length;
			continue;
		}

		const keyOf = (row: Row) =>
			JSON.stringify(
				keyCols.map((c) => canonicalValue(def.columns[c]?.type, row[c])),
			);
		const keyRow = (row: Row) =>
			Object.fromEntries(keyCols.map((c) => [c, row[c]]));
		const servedByKey = new Map(theirs.map((r) => [keyOf(r), r]));
		const replayedKeys = new Set<string>();
		const columns = Object.keys(def.columns).sort();
		for (const row of mine) {
			const key = keyOf(row);
			replayedKeys.add(key);
			const s = servedByKey.get(key);
			if (!s) {
				fail(
					table,
					`${key}: missing (dropped, or deleted after --to)`,
					keyRow(row),
				);
				continue;
			}
			if (heightOf(s) > to) {
				summary.superseded++;
				continue;
			}
			const a = canonicalRow(def, s, columns);
			const b = canonicalRow(def, row, columns);
			// A key first written before the window keeps its original
			// _block_height/_tx_id on the server (upserts never move them);
			// replay never saw that write, so only the columns are comparable.
			if (heightOf(s) < from) {
				a._block_height = b._block_height;
				a._tx_id = b._tx_id;
			}
			const col = firstDifference(a, b);
			if (col === undefined) summary.equal++;
			else
				fail(
					table,
					`${key}: ${col} served ${String(a[col])}, replayed ${String(b[col])}`,
					keyRow(row),
				);
		}
		for (const s of theirsInWindow) {
			if (!replayedKeys.has(keyOf(s)))
				fail(
					table,
					`${keyOf(s)}: extra: no proven input produces it`,
					keyRow(s),
				);
		}
	}
	return { failures, tables };
}
