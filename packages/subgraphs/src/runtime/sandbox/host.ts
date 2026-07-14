// f071 Stage 2a — the host-side membrane + warm per-subgraph worker pool,
// productionizing `spike/f060/d2-worker/host.ts` per the target
// architecture (`docs/internal/security/subgraph-processor-sandbox-spike.md`
// §3.3): one warm worker per active subgraph, keyed by name, spawned lazily
// on the first sandboxed block, reused across blocks, re-`init`ed only on a
// `sg.version` change (mirroring `processor.ts`'s `knownVersions` /
// `definitionCache` contract), and evicted via `invalidateSubgraphRoute`
// (redeploy/delete) — the same invalidation edge the route cache uses.
//
// TRUST SPLIT (spike doc §3.1): this module runs in the HOST thread — it
// holds the open Postgres transaction (via the `SubgraphContext` the caller
// passes in) and lives in the same process as route resolution and the
// master key. The worker it spawns gets `env: {}` (the empirically-verified
// load-bearing scrub) and a resolver-locked-down bundle (`bundle.ts`) — it
// never sees a DB handle, a connection string, or an env var.
import { logger } from "@secondlayer/shared/logger";
import type { BlockMeta, SubgraphContext } from "../context.ts";
import type { RunResult } from "../runner.ts";
import type { MatchedTx } from "../source-matcher.ts";
import { bundleHandlerCode } from "./bundle.ts";
import type {
	BufferedOp,
	HostToWorkerMessage,
	WorkerToHostMessage,
} from "./protocol.ts";

/** Per-block deadline for the worker's `blockDone` (spike doc §3.3 "crash
 *  recovery"): on expiry the worker is terminated + evicted and the error
 *  propagates into the block transaction, which rolls back and becomes a
 *  transient failure in `processBlockWithRetry`'s existing schedule — retry
 *  behavior itself is deliberately unchanged. */
const BLOCK_TIMEOUT_MS = Number.parseInt(
	process.env.SUBGRAPH_SANDBOX_BLOCK_TIMEOUT_MS ?? "60000",
);

interface PoolEntry {
	worker: Worker;
	version: string;
	/** Serializes runs through this worker — a worker can only process one
	 *  block at a time (its read-request/blockDone correlation is per-run).
	 *  The wider system already serializes per-subgraph block processing;
	 *  this is local insurance, not new scheduling. */
	chain: Promise<unknown>;
}

const pool = new Map<string, PoolEntry>();

export interface SandboxRunParams {
	subgraphName: string;
	/** `subgraphs.version` — worker re-`init`s when it changes. */
	version: string;
	/** `subgraphs.handler_code` — bundled host-side on (re)init. */
	handlerCode: string | null;
	/** The SAME live ctx the in-process path would run handlers against —
	 *  bound to the open block transaction. Reads are answered through it;
	 *  the worker's decided ops are replayed onto it; the caller's existing
	 *  `flush()` + outbox flow then runs unchanged. */
	hostCtx: SubgraphContext;
	block: BlockMeta;
	matched: MatchedTx[];
}

class SandboxWorkerCrash extends Error {
	constructor(subgraphName: string, cause: string) {
		super(`sandbox worker for "${subgraphName}" failed: ${cause}`);
		this.name = "SandboxWorkerCrash";
	}
}

/** Exported so the isolation regression test drives the EXACT production
 *  spawn (same entry URL, same env scrub), not a lookalike. */
export function spawnSandboxWorker(): Worker {
	// `env: {}` is the security boundary — the worker's OS-level environment
	// is empty, so SECONDLAYER_SECRETS_KEY (and everything else) is genuinely
	// absent in there, not merely hidden (f060 §2.1 proved a default-env
	// worker leaks it). Never spawn without it.
	return new Worker(new URL("./worker-entry.ts", import.meta.url), { env: {} });
}

async function initWorker(
	worker: Worker,
	subgraphName: string,
	version: string,
	handlerCode: string,
): Promise<void> {
	const bundledCode = await bundleHandlerCode(handlerCode);
	await new Promise<void>((resolve, reject) => {
		const onMsg = (e: MessageEvent) => {
			const msg = e.data as WorkerToHostMessage;
			if (msg.type === "ready" && msg.version === version) {
				cleanup();
				resolve();
			} else if (msg.type === "error") {
				cleanup();
				reject(new SandboxWorkerCrash(subgraphName, msg.message));
			}
		};
		const onErr = (e: ErrorEvent) => {
			cleanup();
			reject(new SandboxWorkerCrash(subgraphName, e.message ?? "worker error"));
		};
		const cleanup = () => {
			worker.removeEventListener("message", onMsg as EventListener);
			worker.removeEventListener("error", onErr as EventListener);
		};
		worker.addEventListener("message", onMsg as EventListener);
		worker.addEventListener("error", onErr as EventListener);
		const init: HostToWorkerMessage = { type: "init", bundledCode, version };
		worker.postMessage(init);
	});
}

/** Get (or lazily spawn) the warm worker for a subgraph, re-`init`ing on a
 *  version change — the worker-pool mirror of `loadSubgraphDefinition`'s
 *  hot-reload contract. */
async function ensureWorker(
	subgraphName: string,
	version: string,
	handlerCode: string | null,
): Promise<PoolEntry> {
	if (handlerCode == null) {
		// A subgraph can only be opted into the sandbox if its handler source
		// is in the control plane (`handler_code`). Rows predating that column
		// (disk-only `handler_path`) must not be silently run in-process when
		// the operator asked for the sandbox — fail the block loudly instead.
		throw new SandboxWorkerCrash(
			subgraphName,
			"subgraph has no handler_code; cannot bundle for the sandbox path",
		);
	}
	const existing = pool.get(subgraphName);
	if (existing && existing.version === version) return existing;

	if (existing) {
		// Version bump — re-init the existing warm worker in place (cheaper
		// than a respawn; spike doc §3.3 "hot-reload").
		try {
			await initWorker(existing.worker, subgraphName, version, handlerCode);
			existing.version = version;
			logger.info("Sandbox worker handler reloaded", {
				subgraph: subgraphName,
				version,
			});
			return existing;
		} catch (err) {
			// Unhealthy worker — replace it below.
			existing.worker.terminate();
			pool.delete(subgraphName);
			logger.warn("Sandbox worker re-init failed; respawning", {
				subgraph: subgraphName,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const worker = spawnSandboxWorker();
	try {
		await initWorker(worker, subgraphName, version, handlerCode);
	} catch (err) {
		worker.terminate();
		throw err;
	}
	const entry: PoolEntry = { worker, version, chain: Promise.resolve() };
	pool.set(subgraphName, entry);
	return entry;
}

/** Terminate + drop a subgraph's warm worker. Wired into
 *  `invalidateSubgraphRoute` (`block-processor.ts`), so redeploys and
 *  deletions evict the worker on the same edge that drops the route cache. */
export function evictSandboxWorker(subgraphName: string): void {
	const entry = pool.get(subgraphName);
	if (!entry) return;
	entry.worker.terminate();
	pool.delete(subgraphName);
}

/** Terminate the whole pool (graceful shutdown / test teardown). */
export function shutdownSandboxPool(): void {
	for (const name of [...pool.keys()]) evictSandboxWorker(name);
}

/**
 * Run one block's matched events through the subgraph's sandbox worker, in
 * place of the in-process `runHandlers(subgraph, matched, ctx)` call — same
 * inputs, same `{processed, errors}` result shape, same ctx left holding
 * the pending ops for the caller's unchanged `flush()` + outbox flow.
 *
 * Membrane, per spike doc §3.2:
 * - the worker runs the REAL dispatch loop (`runHandlers`, imported by
 *   `worker-entry.ts`) over a `WorkerCtx`; writes buffer worker-side;
 * - `readRequest`s are answered here through `hostCtx`'s real
 *   `findOne`/`findMany`/aggregates. PRECISION NOTE (the Step-4 decision):
 *   this is equivalent to a raw base-DB read because `hostCtx`'s ops array
 *   is empty for the entire duration of the worker run — ops are only
 *   replayed onto it AFTER `blockDone` — and `overlayOne`/`overlayMany`
 *   short-circuit to the DB row unchanged when there are no pending ops.
 *   Reusing the real ctx read path (rather than hand-rolling raw SQL here)
 *   keeps SQL construction and `coerceRow`'s uint/int→BigInt coercion
 *   single-sourced with the in-process path; the worker overlays its own
 *   pending ops on the returned row, reconstructing exactly the in-process
 *   composition (raw read → coerce → overlay).
 * - on `blockDone` the worker's `(method, args, tx)` ops are replayed onto
 *   `hostCtx` by calling the real ctx methods (with `setTx` restoring each
 *   op's original tx attribution) — the single source of truth for op
 *   construction. The transaction never crosses the boundary.
 */
export async function runHandlersSandboxed(
	params: SandboxRunParams,
): Promise<RunResult> {
	const { subgraphName, version, handlerCode, hostCtx, block, matched } =
		params;
	const entry = await ensureWorker(subgraphName, version, handlerCode);

	// Serialize per-worker: chain this run behind any in-flight one.
	const run = entry.chain.then(() =>
		runBlockThroughWorker(entry, subgraphName, hostCtx, block, matched),
	);
	// The chain must survive a rejected run (the next block retries fresh).
	entry.chain = run.catch(() => undefined);
	return run;
}

async function runBlockThroughWorker(
	entry: PoolEntry,
	subgraphName: string,
	hostCtx: SubgraphContext,
	block: BlockMeta,
	matched: MatchedTx[],
): Promise<RunResult> {
	const { worker } = entry;

	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	let detach: (() => void) | undefined;

	try {
		const done = new Promise<{ ops: BufferedOp[]; result: RunResult }>(
			(resolve, reject) => {
				const onMsg = async (e: MessageEvent) => {
					const msg = e.data as WorkerToHostMessage;
					if (msg.type === "readRequest") {
						try {
							worker.postMessage({
								type: "readResponse",
								id: msg.id,
								reply: await answerRead(hostCtx, msg),
							} satisfies HostToWorkerMessage);
						} catch (err) {
							reject(
								new SandboxWorkerCrash(
									subgraphName,
									`host read failed: ${err instanceof Error ? err.message : String(err)}`,
								),
							);
						}
						return;
					}
					if (msg.type === "blockDone") {
						resolve({
							ops: msg.ops,
							result: { processed: msg.processed, errors: msg.errors },
						});
						return;
					}
					if (msg.type === "error") {
						reject(new SandboxWorkerCrash(subgraphName, msg.message));
					}
				};
				const onErr = (e: ErrorEvent) => {
					reject(
						new SandboxWorkerCrash(subgraphName, e.message ?? "worker error"),
					);
				};
				detach = () => {
					worker.removeEventListener(
						"message",
						onMsg as unknown as EventListener,
					);
					worker.removeEventListener("error", onErr as EventListener);
				};
				worker.addEventListener("message", onMsg as unknown as EventListener);
				worker.addEventListener("error", onErr as EventListener);
				worker.postMessage({
					type: "runBlock",
					block,
					matched,
				} satisfies HostToWorkerMessage);
			},
		);

		const deadline = new Promise<never>((_, reject) => {
			timeoutHandle = setTimeout(() => {
				reject(
					new SandboxWorkerCrash(
						subgraphName,
						`block ${block.height} exceeded ${BLOCK_TIMEOUT_MS}ms deadline`,
					),
				);
			}, BLOCK_TIMEOUT_MS);
		});

		const { ops, result } = await Promise.race([done, deadline]);

		// End-of-block: replay the worker's decided ops through the REAL ctx —
		// real insert/upsert/increment/update/delete building the real WriteOps
		// (and eventually the real SQL at the caller's flush). setTx restores
		// each op's original tx attribution (context.ts captures _tx_id at
		// queue time, so replay must too).
		for (const op of ops) {
			hostCtx.setTx(op.tx);
			replayOp(hostCtx, op);
		}
		return result;
	} catch (err) {
		// Timeout, worker error, or host-read failure: the worker's state is
		// suspect (it may still be running the old block) — terminate + evict
		// so the retry gets a fresh spawn. The thrown error rolls back the
		// caller's block transaction; processBlockWithRetry retries as usual.
		evictSandboxWorker(subgraphName);
		logger.warn("Sandbox worker run failed; worker evicted", {
			subgraph: subgraphName,
			blockHeight: block.height,
			error: err instanceof Error ? err.message : String(err),
		});
		throw err;
	} finally {
		if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
		detach?.();
	}
}

function replayOp(hostCtx: SubgraphContext, op: BufferedOp): void {
	switch (op.method) {
		case "insert":
			hostCtx.insert(op.table, op.args[0] as Record<string, unknown>);
			return;
		case "upsert":
			hostCtx.upsert(
				op.table,
				op.args[0] as Record<string, unknown>,
				op.args[1] as Record<string, unknown>,
			);
			return;
		case "increment":
			hostCtx.increment(
				op.table,
				op.args[0] as Record<string, unknown>,
				op.args[1] as Record<string, bigint | number>,
			);
			return;
		case "update":
			hostCtx.update(
				op.table,
				op.args[0] as Record<string, unknown>,
				op.args[1] as Record<string, unknown>,
			);
			return;
		case "delete":
			hostCtx.delete(op.table, op.args[0] as Record<string, unknown>);
			return;
	}
}

async function answerRead(
	hostCtx: SubgraphContext,
	msg: Extract<WorkerToHostMessage, { type: "readRequest" }>,
): Promise<Extract<HostToWorkerMessage, { type: "readResponse" }>["reply"]> {
	const { method, table, where, column } = msg;
	switch (method) {
		case "findOne":
			return { kind: "row", row: await hostCtx.findOne(table, where) };
		case "findMany":
			return { kind: "rows", rows: await hostCtx.findMany(table, where) };
		case "count":
			return { kind: "count", count: await hostCtx.count(table, where) };
		case "countDistinct": {
			if (!column) throw new Error("countDistinct read missing column");
			return {
				kind: "count",
				count: await hostCtx.countDistinct(table, column, where),
			};
		}
		case "sum": {
			if (!column) throw new Error("sum read missing column");
			const v = await hostCtx.sum(table, column, where);
			return { kind: "amount", amount: v.toString() };
		}
		case "min": {
			if (!column) throw new Error("min read missing column");
			const v = await hostCtx.min(table, column, where);
			return { kind: "amount", amount: v == null ? null : v.toString() };
		}
		case "max": {
			if (!column) throw new Error("max read missing column");
			const v = await hostCtx.max(table, column, where);
			return { kind: "amount", amount: v == null ? null : v.toString() };
		}
	}
}
