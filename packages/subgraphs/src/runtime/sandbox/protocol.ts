// f071 Stage 2a — message protocol between the host membrane (`host.ts`) and
// a sandbox worker (`worker-entry.ts`). Deliberately explicit about what
// crosses the boundary, per the target architecture's "ctx membrane" table
// (`docs/internal/security/subgraph-processor-sandbox-spike.md` §3.2): no
// live objects, no functions, no transaction handle, no secrets — only
// plain, structured-clone-safe data (BigInt included — Bun's `postMessage`
// structured-clones BigInt natively, verified empirically before relying on
// it here).
import type { BlockMeta, TxMeta } from "../context.ts";
import type { MatchedTx } from "../source-matcher.ts";

/**
 * One decided write, in the exact shape the host replays it: the real ctx
 * method name + the exact arguments a handler passed it, plus the tx meta
 * that was current when the handler queued it. The host reconstructs the
 * real `WriteOp` (and therefore the real SQL) by `hostCtx.setTx(op.tx)`
 * then `hostCtx[method](table, ...args)` on its own live `SubgraphContext`
 * — the host's ctx methods are the SINGLE SOURCE OF TRUTH for op
 * construction (spike doc §3.2/§4: "flush() … host replays each op onto a
 * real SubgraphContext and calls the real flush()"). `tx` matters because
 * `insert`/`upsert`/`increment` capture `_tx_id` at call time
 * (context.ts:130/160/239) — replaying without it would stamp every row
 * with the block's initial (empty) tx meta instead of the tx that produced
 * it. This shape is intentionally NOT the internal `WriteOp`
 * `{kind,data,set}` shape context.ts uses privately — that shape embeds
 * control keys that only make sense once reconstructed by the real methods.
 */
export interface BufferedOp {
	method: "insert" | "upsert" | "increment" | "update" | "delete";
	table: string;
	args: unknown[];
	/** Tx meta current at queue time — host does `setTx(tx)` before replay. */
	tx: TxMeta;
}

/**
 * A read reply from the host. `findOne`/`findMany` carry the raw
 * (no-overlay) base-DB row(s) — the worker overlays its own pending ops on
 * top (see `overlay.ts`); the overlay computation never crosses the
 * boundary. The aggregate reads (`count`/`sum`/`min`/`max`/`countDistinct`)
 * are NOT overlaid in production either (`context.ts:71`: "Aggregate reads
 * … remain pre-flush DB state") — the host's raw value crosses unmodified.
 * `amount` for `sum`/`min`/`max` is `string | null` (Bun's structured clone
 * does support BigInt, but the wire type stays a string so the shape
 * doesn't quietly depend on that Bun-specific guarantee); the worker parses
 * back to `bigint`.
 */
export type ReadReply =
	| { kind: "row"; row: Record<string, unknown> | null }
	| { kind: "rows"; rows: Record<string, unknown>[] }
	| { kind: "count"; count: number }
	| { kind: "amount"; amount: string | null };

export type ReadMethod =
	| "findOne"
	| "findMany"
	| "count"
	| "sum"
	| "min"
	| "max"
	| "countDistinct";

export type HostToWorkerMessage =
	| {
			type: "init";
			/** esbuild-bundled `handler_code` (see `bundle.ts`) — a single,
			 *  dependency-free ESM string the worker stages to disk and
			 *  `import()`s. The imported module's default export is the full
			 *  `SubgraphDefinition` (same contract as `processor.ts`'s
			 *  `loadSubgraphDefinition`), so the worker derives `handlers`,
			 *  `sources` (filter lookup for payload building), and `schema`
			 *  (uniqueKeys lookups for upsert/increment) from its OWN copy — the
			 *  host never ships them separately, so they can't drift from the
			 *  handlers they were authored with. */
			bundledCode: string;
			/** `sg.version` at bundle time — the host re-`init`s only on a
			 *  version bump (mirrors `processor.ts`'s `knownVersions`). */
			version: string;
	  }
	| {
			type: "runBlock";
			block: BlockMeta;
			matched: MatchedTx[];
	  }
	| {
			type: "readResponse";
			id: number;
			reply: ReadReply;
	  }
	| { type: "shutdown" };

export type WorkerToHostMessage =
	| { type: "ready"; version: string }
	| {
			type: "readRequest";
			id: number;
			method: ReadMethod;
			table: string;
			where: Record<string, unknown>;
			/** Column argument for count/sum/min/max/countDistinct; unused by
			 *  findOne/findMany. */
			column?: string;
	  }
	| {
			type: "blockDone";
			ops: BufferedOp[];
			processed: number;
			errors: number;
			handlerMs: number;
	  }
	| { type: "error"; message: string };

/** Re-exported for callers that only need these shapes with the protocol. */
export type { BlockMeta, TxMeta };
