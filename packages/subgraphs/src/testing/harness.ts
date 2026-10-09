import type { EventForFilter } from "../events.ts";
import type { TypedSubgraphContext } from "../infer.ts";
import { SubgraphContext } from "../runtime/context.ts";
import type { BlockMeta, TxMeta } from "../runtime/context.ts";
import { MemoryStore, MemorySubgraphContext } from "../runtime/memory-store.ts";
import { buildEventPayload } from "../runtime/runner.ts";
import type { SubgraphFilter, SubgraphSchema } from "../types.ts";

/**
 * `@secondlayer/subgraphs/testing` — run a handler without deploying.
 *
 * There was no way to execute a handler outside production: seventeen `sl
 * subgraphs` subcommands and none ran one, `dev` deployed DDL and printed
 * handler keys, `--dry-run` validated schema only. The cost was measurable —
 * three of four production subgraphs shipped broken, including one that held
 * 0 rows chain-wide for a whole release because of a 3-line field-mapping bug
 * that a single fixture event would have caught.
 *
 * The context here is the REAL {@link SubgraphContext} with its row store
 * swapped for memory. Read-your-writes, upsert merging, increment deltas,
 * where-matching, and control-key handling all come from the one
 * implementation, so there is no second copy to drift.
 */

function defaultBlock(overrides: Partial<BlockMeta> = {}): BlockMeta {
	return {
		height: 1,
		hash: "0xtest",
		timestamp: 0,
		burnBlockHeight: 1,
		...overrides,
	};
}

export function defaultTx(overrides: Partial<TxMeta> = {}): TxMeta {
	return {
		txId: "0xtest-tx",
		sender: "SP000000000000000000002Q6VF78",
		type: "contract_call",
		status: "success",
		contractId: null,
		functionName: null,
		...overrides,
	};
}

/** An in-memory subgraph context for tests. */
export interface TestSubgraphContext<S extends SubgraphSchema>
	extends Omit<TypedSubgraphContext<S>, never> {
	/**
	 * Current rows of `table`, INCLUDING writes queued by the handler you just
	 * ran (the same read-your-writes overlay the runtime uses). Drop straight
	 * into `toMatchInlineSnapshot()`.
	 */
	rows(table: keyof S & string): Promise<Record<string, unknown>[]>;
	/** Commit pending writes into the in-memory store, as an end-of-block flush
	 *  would — call between blocks when a test spans several. */
	commit(): Promise<void>;
	/** Swap the transaction metadata handlers see (`ctx.tx`). */
	setTx(tx: Partial<TxMeta>): void;
	/** Insert ops queued since `opsCheckpoint()`, for preview IN/OUT traces. */
	pendingInsertsSince(
		checkpoint: number,
	): Array<{ table: string; keys: string[]; row: Record<string, unknown> }>;
	/** Length of the pending-ops queue (same as runtime `opsCheckpoint`). */
	opsCheckpoint(): number;
}

/**
 * Build an in-memory context for a subgraph's schema.
 *
 * ```ts
 * const ctx = createTestContext(bns.schema, { block: { height: 167_484 } });
 * await bns.handlers.bns!(buildEvent(bns.sources.bns, { … }), ctx);
 * expect(await ctx.rows("names")).toMatchInlineSnapshot();
 * ```
 */
export function createTestContext<const S extends SubgraphSchema>(
	schema: S,
	options: {
		block?: Partial<BlockMeta>;
		tx?: Partial<TxMeta>;
		/** Stubbed `ctx.client.readOnly` results, keyed
		 *  `"<contractId>.<function-name>"`. */
		reads?: Record<string, unknown>;
	} = {},
): TestSubgraphContext<S> {
	const impl = new MemorySubgraphContext(
		new MemoryStore(),
		schema,
		defaultBlock(options.block),
		defaultTx(options.tx),
	);
	impl.setReads(options.reads ?? {});
	const ctx = impl as unknown as TestSubgraphContext<S>;
	ctx.rows = (table) => impl.rowsOf(table);
	ctx.commit = () => impl.commitOps();
	// Call through the prototype: assigning `ctx.setTx = () => impl.setTx(...)`
	// would recurse because ctx === impl and the own property shadows the method.
	ctx.setTx = (tx) => {
		SubgraphContext.prototype.setTx.call(impl, defaultTx(tx));
	};
	ctx.pendingInsertsSince = (checkpoint) => impl.insertsSince(checkpoint);
	// opsCheckpoint stays on the SubgraphContext prototype — do not overwrite.
	return ctx;
}

/**
 * Build a handler-shaped event payload for a source, typed by that source's
 * filter. `data` supplies the decoded, camelCased fields the runtime would
 * have produced; block/tx metadata is filled in.
 *
 * ```ts
 * buildEvent(bns.sources.bns, {
 *   topic: "name-register",
 *   data: { name: { name: "0x616c696365", namespace: "0x627463" } },
 * })
 * ```
 */
export function buildEvent<const F extends SubgraphFilter>(
	source: F,
	// Loose on the way IN, exact on the way OUT. `Partial<EventForFilter<F>>`
	// would be nicer, but for a contract_call source carrying an `abi` it
	// instantiates the deep `ExtractFunctionArgs`/`AbiToTS` conditional and
	// TS gives up (TS2589) — the same hazard `runtime/runner.ts` documents at
	// its `clarityValueToJS` call. The RETURN type is exact, which is what
	// makes the event assignable to the handler.
	payload: Record<string, unknown>,
	options: { tx?: Partial<TxMeta> } = {},
): EventForFilter<F> {
	const tx = defaultTx(options.tx);
	const base: Record<string, unknown> = { type: source.type, tx };
	if (source.type === "print_event") {
		base.contractId = source.contractId ?? "";
		base.topic = "";
		base.data = {};
	} else if (source.type === "contract_call") {
		base.contractId = source.contractId ?? "";
		base.functionName = source.functionName ?? "";
		base.sender = tx.sender;
		base.args = [];
		base.result = null;
		base.resultHex = null;
	}
	// Double cast: the exact return type is the point, but TS cannot check
	// the assignment through the deep ABI conditional (see above).
	return { ...base, ...payload } as unknown as EventForFilter<F>;
}

export { buildEventPayload };
export type { BlockMeta, TxMeta };
