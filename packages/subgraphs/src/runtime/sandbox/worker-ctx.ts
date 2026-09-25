// f071 Stage 2a — the worker-side proxy `ctx` handed to a sandboxed handler.
// Mirrors `SubgraphContext`'s (`context.ts`) full public surface so a
// handler written against the real ctx behaves identically here — the only
// difference the handler can observe is that writes never touch a DB until
// the host replays them at end-of-block (`host.ts`).
//
// Transport-agnostic on purpose: this class takes an injected `sendRead`
// callback rather than owning `postMessage`/`onmessage` itself, so it can be
// unit-tested directly (`overlay-parity.test.ts` instantiates it with a
// stub transport and compares its `findOne`/`findMany` results against a
// real `SubgraphContext` hitting a real Postgres) without spinning up an
// actual `Worker` thread. `worker-entry.ts` is the only place that wires a
// real `postMessage` transport in.
import type { SubgraphSchema } from "../../types.ts";
import type { BlockMeta, TxMeta } from "../context.ts";
import {
	type WriteOp,
	buildDeleteOp,
	buildIncrementOp,
	buildInsertOp,
	buildUpdateOp,
	buildUpsertOp,
	overlayMany,
	overlayOne,
} from "./overlay.ts";
import type { BufferedOp, ReadMethod, ReadReply } from "./protocol.ts";

export type SendRead = (
	method: ReadMethod,
	table: string,
	where: Record<string, unknown>,
) => Promise<ReadReply>;

export class WorkerCtx {
	readonly block: BlockMeta;
	private _tx: TxMeta;
	private readonly schema: SubgraphSchema;
	private readonly sendRead: SendRead;

	/** Overlay input — mirrors `context.ts`'s private `ops: WriteOp[]`
	 *  (:79) exactly; never leaves the worker. */
	private readonly ops: WriteOp[] = [];
	/** What ships home at `blockDone` — the host replays these via its own
	 *  real ctx methods (single source of truth for the actual SQL). Kept
	 *  in lockstep with `ops` (same length always) so one checkpoint index
	 *  rolls both back together. */
	private readonly buffered: BufferedOp[] = [];

	constructor(
		block: BlockMeta,
		schema: SubgraphSchema,
		tx: TxMeta,
		sendRead: SendRead,
	) {
		this.block = block;
		this.schema = schema;
		this._tx = tx;
		this.sendRead = sendRead;
	}

	get tx(): TxMeta {
		return this._tx;
	}

	/** Mirrors `context.ts:118-121` — called by the worker-side dispatch
	 *  loop between events (`worker-entry.ts`), same as `runner.ts` does
	 *  in-process. */
	setTx(tx: TxMeta): void {
		this._tx = tx;
	}

	private validateTable(table: string): void {
		if (!this.schema[table]) {
			throw new Error(
				`Table "${table}" not found in subgraph schema. Available: [${Object.keys(this.schema).join(", ")}]`,
			);
		}
	}

	private meta() {
		return { blockHeight: this.block.height, txId: this._tx.txId };
	}

	// --- Write operations (buffered locally, replayed host-side at flush) ---

	insert(table: string, row: Record<string, unknown>): void {
		this.validateTable(table);
		this.ops.push(buildInsertOp(table, row, this.meta()));
		this.buffered.push({
			method: "insert",
			table,
			args: [row],
			tx: { ...this._tx },
		});
	}

	update(
		table: string,
		where: Record<string, unknown>,
		set: Record<string, unknown>,
	): void {
		this.validateTable(table);
		this.ops.push(buildUpdateOp(table, where, set));
		this.buffered.push({
			method: "update",
			table,
			args: [where, set],
			tx: { ...this._tx },
		});
	}

	upsert(
		table: string,
		key: Record<string, unknown>,
		row: Record<string, unknown>,
	): void {
		this.validateTable(table);
		const op = buildUpsertOp(table, key, row, this.schema, this.meta());
		if (!op) return; // mirrors context.ts:150 — no such table def, no-op
		this.ops.push(op);
		this.buffered.push({
			method: "upsert",
			table,
			args: [key, row],
			tx: { ...this._tx },
		});
	}

	increment(
		table: string,
		key: Record<string, unknown>,
		deltas: Record<string, bigint | number>,
	): void {
		this.validateTable(table);
		// Throws BEFORE either array is pushed to, matching context.ts (the
		// real increment() validates, then pushes) — a rejected increment call
		// must never appear in either the overlay or the shipped-home ops.
		const op = buildIncrementOp(table, key, deltas, this.schema, this.meta());
		this.ops.push(op);
		this.buffered.push({
			method: "increment",
			table,
			args: [key, deltas],
			tx: { ...this._tx },
		});
	}

	delete(table: string, where: Record<string, unknown>): void {
		this.validateTable(table);
		this.ops.push(buildDeleteOp(table, where));
		this.buffered.push({
			method: "delete",
			table,
			args: [where],
			tx: { ...this._tx },
		});
	}

	// --- Read operations — round-trip to host for the raw base-DB state,
	// then overlay this worker's own pending ops locally (never round-tripped). ---

	async findOne(
		table: string,
		where: Record<string, unknown>,
	): Promise<Record<string, unknown> | null> {
		this.validateTable(table);
		const reply = await this.sendRead("findOne", table, where);
		const row = reply.kind === "row" ? reply.row : null;
		return overlayOne(this.ops, table, where, row);
	}

	async findMany(
		table: string,
		where: Record<string, unknown>,
	): Promise<Record<string, unknown>[]> {
		this.validateTable(table);
		const reply = await this.sendRead("findMany", table, where);
		const rows = reply.kind === "rows" ? reply.rows : [];
		return overlayMany(this.ops, table, where, rows);
	}

	// --- Ops checkpoint (per-event atomicity) — mirrors context.ts:249-263 ---

	opsCheckpoint(): number {
		return this.ops.length;
	}

	rollbackTo(checkpoint: number): void {
		if (checkpoint < 0 || checkpoint > this.ops.length) return;
		this.ops.length = checkpoint;
		this.buffered.length = checkpoint;
	}

	/** What ships home at end-of-block — the host replays each in order via
	 *  its own real ctx methods (`host.ts`). */
	get pendingOps(): readonly BufferedOp[] {
		return this.buffered;
	}
}
