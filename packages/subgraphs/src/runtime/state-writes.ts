/**
 * Node storage writes (`state_writes`) → the `var_set` / `map_set` /
 * `map_delete` events a state-level subgraph's handlers receive.
 *
 * The served runtime and client replay both call {@link stateWriteEvents} and
 * nothing else, so the events a handler saw on the server are exactly the ones
 * a verifier recomputes from the header-backed diff.
 */
import { vmEventId } from "./batch-loader.ts";
import type { EventRecord, TxRecord } from "./source-matcher.ts";

/** One `state_writes` row (migration 0154), as the DB tap and the API serve it. */
export interface StateWriteRow {
	ordinal: number;
	/** Null for a block-level write (no transaction). */
	tx_index: number | null;
	/** MARF key, e.g. `vm::<contract>::0::<map>::<keyhex>`. */
	key: string;
	/** Hex of the stored value string's UTF-8 bytes. */
	value_hex: string;
}

export type StateWriteKey =
	| { contractId: string; kind: "map"; map: string; rawKey: string }
	| { contractId: string; kind: "var"; varName: string };

/** clarity_db.rs StoreType discriminants, formatted in decimal inside keys. */
const DATA_MAP = "0";
const VARIABLE = "1";
const HEX = /^(?:[0-9a-f]{2})+$/;

/**
 * `vm::<c>::0::<map>::<keyhex>` | `vm::<c>::1::<var>`; null for every other key
 * (FT balances, NFT owners, contract metadata, accounts, `__MARF_*`).
 */
export function parseStateWriteKey(key: string): StateWriteKey | null {
	if (!key.startsWith("vm::")) return null;
	const parts = key.slice(4).split("::");
	const [contractId, store] = parts;
	if (!contractId?.includes(".")) return null;
	if (store === DATA_MAP && parts.length === 4) {
		const [, , map, rawKey] = parts;
		if (!map || !rawKey || !HEX.test(rawKey)) return null;
		return { contractId, kind: "map", map, rawKey };
	}
	if (store === VARIABLE && parts.length === 3 && parts[2]) {
		return { contractId, kind: "var", varName: parts[2] };
	}
	return null;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The stored value string a `value_hex` encodes (lowercase hex of a CV). */
function storedValue(w: StateWriteRow): string {
	const h = w.value_hex.startsWith("0x") ? w.value_hex.slice(2) : w.value_hex;
	const bytes = new Uint8Array(h.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
	}
	let value: string;
	try {
		value = utf8.decode(bytes);
	} catch {
		throw new Error(`state write ${w.ordinal} value is not UTF-8 hex`);
	}
	value = value.toLowerCase();
	if (!HEX.test(value)) {
		throw new Error(`state write ${w.ordinal} value is not a Clarity value`);
	}
	return value;
}

/** The handler event one named write becomes, or null when it is not one. */
function writeEvent(
	w: StateWriteRow,
): { type: string; data: Record<string, string> } | null {
	const key = parseStateWriteKey(w.key);
	if (!key) return null;
	const value = storedValue(w);
	if (key.kind === "var") {
		return {
			type: "var_set",
			data: {
				contract_identifier: key.contractId,
				var_name: key.varName,
				raw_value: `0x${value}`,
			},
		};
	}
	const base = {
		contract_identifier: key.contractId,
		map_name: key.map,
		raw_key: `0x${key.rawKey}`,
	};
	// put_value stores a map entry as (some value); a delete stores none.
	if (value === "09") return { type: "map_delete", data: base };
	if (value.startsWith("0a")) {
		return {
			type: "map_set",
			data: { ...base, raw_value: `0x${value.slice(2)}` },
		};
	}
	throw new Error(
		`state write ${w.ordinal} map value is neither (some v) nor none`,
	);
}

/**
 * A block's named writes as handler events, in node write order, plus the
 * transactions they hang on.
 *
 * Every returned tx carries `tx_index: 0`, so the runner's (tx_index,
 * event_index) sort dispatches by ordinal alone: node write order, including
 * block-level writes that land between transactions. Block-level writes
 * (`tx_index` null) share one synthetic tx with an empty id.
 *
 * Storage cannot tell `map_insert` from `map_set`, so no `map_insert` event is
 * ever produced; such sources are not state-level.
 */
export function stateWriteEvents(
	writes: StateWriteRow[],
	txByIndex: ReadonlyMap<number, TxRecord>,
): { txs: TxRecord[]; vmEvents: EventRecord[] } {
	const txs = new Map<number | null, TxRecord>();
	const vmEvents: EventRecord[] = [];
	for (const w of [...writes].sort((a, b) => a.ordinal - b.ordinal)) {
		const event = writeEvent(w);
		if (!event) continue;
		let tx = txs.get(w.tx_index);
		if (!tx) {
			if (w.tx_index === null) {
				tx = { tx_id: "", type: "block", sender: "", status: "success" };
			} else {
				const real = txByIndex.get(w.tx_index);
				if (!real) {
					throw new Error(
						`state write ${w.ordinal} names tx_index ${w.tx_index} the block does not have`,
					);
				}
				tx = real;
			}
			tx = { ...tx, tx_index: 0 };
			txs.set(w.tx_index, tx);
		}
		vmEvents.push({
			id: vmEventId(tx.tx_id || "block", w.ordinal),
			tx_id: tx.tx_id,
			type: event.type,
			event_index: w.ordinal,
			data: event.data,
			clock: "vm",
		});
	}
	return { txs: [...txs.values()], vmEvents };
}
