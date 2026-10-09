import type { AbiContract } from "@secondlayer/stacks/clarity";
import { normalizeAbi, toCamelCase } from "@secondlayer/stacks/clarity";
import type { SubgraphSchema } from "../types.ts";
import type { ChainReadClient } from "./chain-read.ts";
import { type BlockMeta, SubgraphContext, type TxMeta } from "./context.ts";

/**
 * Committed subgraph rows held in memory: what a flush would have persisted,
 * per table, in insertion order. Shared across the per-block contexts of a
 * multi-block run (replay), or owned by one context (handler unit tests).
 */
export class MemoryStore {
	readonly tables: Map<string, Record<string, unknown>[]> = new Map();
}

/**
 * The real {@link SubgraphContext} with its row store swapped for memory.
 * Read-your-writes, upsert merging, increment deltas, where-matching and
 * control-key handling all come from the one implementation, so the memory
 * model and the Postgres flush cannot drift apart in two copies.
 */
export class MemorySubgraphContext extends SubgraphContext {
	private readonly store: MemoryStore;

	constructor(
		store: MemoryStore,
		schema: SubgraphSchema,
		block: BlockMeta,
		tx: TxMeta,
	) {
		// `db` is never touched: `readRows` is overridden below, and a memory
		// context never flushes SQL.
		super(undefined as never, "memory", schema, block, tx, false);
		this.store = store;
	}

	/** The one seam: committed rows come from memory, not Postgres. */
	protected override async readRows(
		table: string,
		where: Record<string, unknown>,
		limit?: number,
	): Promise<Record<string, unknown>[]> {
		const rows = (this.store.tables.get(table) ?? []).filter((row) =>
			Object.entries(where).every(([k, v]) => sameValue(row[k], v)),
		);
		return limit === undefined ? rows : rows.slice(0, limit);
	}

	/** Current rows of `table`, pending ops overlaid exactly as a read would. */
	async rowsOf(table: string): Promise<Record<string, unknown>[]> {
		return this.overlayMany(table, {}, await this.readRows(table, {}));
	}

	/**
	 * Offline `ctx.client`. There is no node, so reads are stubbed by
	 * `<contractId>.<function-name>`; an unstubbed read throws naming the key,
	 * rather than silently returning undefined and failing somewhere else.
	 */
	setReads(reads: Record<string, unknown>): void {
		this._client = {
			contract(contractId: string, abi: AbiContract) {
				const camelToKebab = new Map<string, string>();
				for (const fn of normalizeAbi(abi).functions) {
					camelToKebab.set(toCamelCase(fn.name), fn.name);
				}
				const read = new Proxy(
					{},
					{
						get(_target, prop: string) {
							const fnName = camelToKebab.get(prop) ?? prop;
							const key = `${contractId}.${fnName}`;
							return async () => {
								if (!(key in reads)) {
									throw new Error(
										`No stubbed chain read for "${key}" — pass it via createTestContext(schema, { reads: { "${key}": … } }).`,
									);
								}
								return reads[key];
							};
						},
					},
				);
				return { read } as never;
			},
		} as ChainReadClient;
	}

	/** Materialize pending ops into the store (an end-of-block flush). */
	async commitOps(): Promise<void> {
		const tables = new Set<string>();
		for (const op of this.ops) tables.add(op.table);
		for (const table of tables) {
			this.store.tables.set(table, await this.rowsOf(table));
		}
		this.ops.length = 0;
	}

	/** Insert ops queued since `checkpoint`, for preview IN/OUT traces. */
	insertsSince(
		checkpoint: number,
	): Array<{ table: string; keys: string[]; row: Record<string, unknown> }> {
		const out: Array<{
			table: string;
			keys: string[];
			row: Record<string, unknown>;
		}> = [];
		for (const op of this.ops.slice(Math.max(0, checkpoint))) {
			if (op.kind !== "insert") continue;
			const row = { ...op.data };
			out.push({
				table: op.table,
				keys: Object.keys(row).filter((k) => !k.startsWith("_")),
				row,
			});
		}
		return out;
	}
}

/** Loose value equality across the bigint/number/string boundary decoded
 *  Clarity values straddle. */
function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (
		(typeof a === "bigint" || typeof a === "number") &&
		(typeof b === "bigint" || typeof b === "number")
	) {
		return BigInt(a) === BigInt(b);
	}
	return String(a) === String(b);
}
