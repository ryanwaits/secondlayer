import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
// f071 Stage A — the host-side membrane + warm per-subgraph SUBPROCESS pool,
// per the target architecture (`docs/internal/security/subgraph-processor-sandbox-spike.md`
// §3.3, substrate updated by the Stage A addendum): one warm subprocess per
// active subgraph, keyed by name, spawned lazily on the first sandboxed
// block, reused across blocks, re-`init`ed only on a `sg.version` change
// (mirroring `processor.ts`'s `knownVersions`/`definitionCache` contract),
// and evicted via `invalidateSubgraphRoute` (redeploy/delete) — the same
// invalidation edge the route cache uses.
//
// SUBSTRATE: this module used to spawn a Bun `Worker` (a thread inside this
// process). Stage 2a's own isolation test (`isolation.test.ts`, kept as a
// regression lock) proved that substrate does NOT isolate untrusted code —
// `Bun.spawnSync` and bare `process.env` from inside a Worker reach the
// HOST's real environ regardless of the Worker's `env: {}`, because a Worker
// is a thread, not a process. `spawnSandboxProcess` below spawns a REAL OS
// process instead: a child spawned with an explicit, from-scratch env
// allowlist has that scrub at the OS level — its own `process.env`,
// `Bun.env`, AND anything IT spawns inherit the scrub, not the host's.
// `subprocess-isolation.test.ts` proves this empirically. `spawnSandboxWorker`
// (still exported below) is retained ONLY so `isolation.test.ts` keeps
// exercising the actual disproven Worker substrate — the pool below no
// longer calls it.
//
// TRUST SPLIT (spike doc §3.1, unchanged by the substrate swap): this module
// runs in the HOST process — it holds the open Postgres transaction (via the
// `SubgraphContext` the caller passes in) and lives in the same process as
// route resolution and the master key. The sandboxed subprocess it spawns
// gets a from-scratch env allowlist (PATH only — never `process.env`
// spread) and a resolver-locked-down bundle (`bundle.ts`) — it never sees a
// DB handle, a connection string, or a host env var.
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

/** Per-block deadline for the subprocess's `blockDone` (spike doc §3.3 "crash
 *  recovery"): on expiry the subprocess is killed + evicted and the error
 *  propagates into the block transaction, which rolls back and becomes a
 *  transient failure in `processBlockWithRetry`'s existing schedule — retry
 *  behavior itself is deliberately unchanged. */
const BLOCK_TIMEOUT_MS = Number.parseInt(
	process.env.SUBGRAPH_SANDBOX_BLOCK_TIMEOUT_MS ?? "60000",
);

const SUBPROCESS_ENTRY_PATH = fileURLToPath(
	new URL("./subprocess-entry.ts", import.meta.url),
);

/**
 * Thin wrapper over `Bun.spawn`'s IPC surface so the rest of this module
 * (`ensureSandboxProcess`/`runBlockThroughProcess`) can treat the transport
 * the same shape `Worker` offered (`postMessage`-like `send`, a settable
 * message sink, `terminate`-like `kill`) without leaking Bun's
 * callback-at-spawn-time IPC API (`ipc` is fixed when `Bun.spawn` is called;
 * there is no `addEventListener` to attach/detach per run) into call sites.
 */
interface SandboxProcess {
	send(msg: HostToWorkerMessage): void;
	kill(): void;
	/** Resolves once, whenever the child actually exits (crash, kill, or a
	 *  clean `process.exit`). Never rejects. */
	readonly exited: Promise<number>;
	setOnMessage(handler: ((msg: WorkerToHostMessage) => void) | null): void;
}

/**
 * Exported so the containment test (`subprocess-isolation.test.ts`) drives
 * the EXACT production spawn (same entry path, same from-scratch env
 * allowlist), not a lookalike — mirrors why `spawnSandboxWorker` used to be
 * exported for `isolation.test.ts`.
 */
export function spawnSandboxProcess(): SandboxProcess {
	let onMessage: ((msg: WorkerToHostMessage) => void) | null = null;
	const proc = Bun.spawn({
		// `--no-env-file` is NOT optional. LOAD-BEARING FINDING from building
		// this: Bun auto-loads `.env`/`.env.local` for ANY `bun <file>`
		// invocation based on the CHILD's own cwd — independent of, and
		// applied AFTER, whatever `env` object is passed to `Bun.spawn`. The
		// first version of this function passed only `env: { PATH }` (no
		// flag) and the subprocess-isolation containment test caught it
		// immediately: the REAL repo `.env.local`'s `SECONDLAYER_SECRETS_KEY`
		// showed up in the child's `process.env` anyway, because the child's
		// cwd defaulted to the host's cwd (inside this repo, where
		// `.env.local` lives) and Bun loaded it on the child's own startup,
		// completely bypassing the explicit allowlist. `--no-env-file` plus a
		// `cwd` outside the repo (below) are both required, as defense in
		// depth against either mechanism alone changing behavior in a future
		// Bun version.
		cmd: [process.execPath, "--no-env-file", SUBPROCESS_ENTRY_PATH],
		// Explicit, from-scratch allowlist — NEVER spread process.env. PATH is
		// the only entry: the security boundary here is that this is the CHILD
		// PROCESS's own OS-level environ (unlike a Bun Worker's `env: {}`, which
		// only scrubbed the in-process thread's view — spike doc §10 / the
		// Stage A addendum), so shipping PATH does not leak
		// SECONDLAYER_SECRETS_KEY or any other host secret; it only lets the
		// child's own shell lookups (e.g. a hostile handler's
		// `Bun.spawnSync(["/bin/sh", ...])`) resolve a shell binary at all —
		// what that shell then sees for `$SECONDLAYER_SECRETS_KEY` is this
		// process's own (absent) environ, not the host's.
		env: { PATH: process.env.PATH ?? "" },
		// Run from the OS tmp dir, not this repo's checkout — belt-and-braces
		// alongside --no-env-file (see above) so the child never has a
		// `.env.local` in its own cwd to find in the first place, and never
		// has an implicit relative-path view into the trusted repo tree.
		cwd: tmpdir(),
		// No extra inherited fds: stdin unused, stdout unused (all real
		// messaging is over the IPC channel Bun opens separately), stderr
		// piped for diagnostics only (never parsed for control flow).
		stdio: ["ignore", "ignore", "pipe"],
		serialization: "advanced",
		ipc(message) {
			onMessage?.(message as WorkerToHostMessage);
		},
	});
	// Diagnostics only — never load-bearing for isolation (the child's own
	// environ never held a host secret, so nothing sensitive can appear
	// here). Streamed chunk-by-chunk rather than buffered until the process
	// exits: these subprocesses are warm and reused across many blocks, so
	// waiting for stream-close (`new Response(stream).text()`) would delay a
	// hostile/buggy handler's stderr until eventual pool shutdown — too late
	// to be useful for live debugging.
	void (async () => {
		const reader = proc.stderr.getReader();
		const decoder = new TextDecoder();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const text = decoder.decode(value, { stream: true });
				if (text.trim()) {
					logger.warn("Sandbox subprocess stderr", { stderr: text.trim() });
				}
			}
		} catch {
			// Stream read failure is itself just a diagnostics-path no-op.
		}
	})();
	return {
		send: (msg) => proc.send(msg),
		kill: () => proc.kill(),
		exited: proc.exited,
		setOnMessage: (handler) => {
			onMessage = handler;
		},
	};
}

/**
 * Retained ONLY so `isolation.test.ts` keeps spawning a REAL Bun `Worker` —
 * that test is a deliberate CI regression lock proving the Worker substrate
 * does NOT isolate untrusted code (spike doc §10); it must keep exercising
 * the actual broken substrate, not a lookalike, or the lock stops meaning
 * anything. The production pool below no longer calls this —
 * `spawnSandboxProcess` is the substrate Stage A ships.
 */
export function spawnSandboxWorker(): Worker {
	return new Worker(new URL("./worker-entry.ts", import.meta.url), {
		env: {},
	});
}

interface PoolEntry {
	proc: SandboxProcess;
	version: string;
	/** Serializes runs through this subprocess — a subprocess can only
	 *  process one block at a time (its read-request/blockDone correlation is
	 *  per-run). The wider system already serializes per-subgraph block
	 *  processing; this is local insurance, not new scheduling. */
	chain: Promise<unknown>;
}

const pool = new Map<string, PoolEntry>();

export interface SandboxRunParams {
	subgraphName: string;
	/** `subgraphs.version` — subprocess re-`init`s when it changes. */
	version: string;
	/** `subgraphs.handler_code` — bundled host-side on (re)init. */
	handlerCode: string | null;
	/** The SAME live ctx the in-process path would run handlers against —
	 *  bound to the open block transaction. Reads are answered through it;
	 *  the subprocess's decided ops are replayed onto it; the caller's
	 *  existing `flush()` + outbox flow then runs unchanged. */
	hostCtx: SubgraphContext;
	block: BlockMeta;
	matched: MatchedTx[];
}

class SandboxWorkerCrash extends Error {
	constructor(subgraphName: string, cause: string) {
		super(`sandbox subprocess for "${subgraphName}" failed: ${cause}`);
		this.name = "SandboxWorkerCrash";
	}
}

async function initSandboxProcess(
	proc: SandboxProcess,
	subgraphName: string,
	version: string,
	handlerCode: string,
): Promise<void> {
	const bundledCode = await bundleHandlerCode(handlerCode);
	let settled = false;
	const ready = new Promise<void>((resolve, reject) => {
		proc.setOnMessage((msg) => {
			if (msg.type === "ready" && msg.version === version) {
				settled = true;
				proc.setOnMessage(null);
				resolve();
			} else if (msg.type === "error") {
				settled = true;
				proc.setOnMessage(null);
				reject(new SandboxWorkerCrash(subgraphName, msg.message));
			}
		});
		const init: HostToWorkerMessage = { type: "init", bundledCode, version };
		proc.send(init);
	});
	// A subprocess that dies before responding (bad bundle, bun crash, OOM at
	// import time) must fail init loudly rather than hang forever — mirrors
	// the old Worker path's `onerror` handler, re-homed onto `exited` since a
	// subprocess has no generic "error" event. Guarded by `settled` so this
	// never fires (or throws) once `ready` has already resolved/rejected via
	// a real message — including long after, when the subprocess eventually
	// exits during normal pool shutdown.
	const crashed = proc.exited.then((code) => {
		if (settled) return;
		throw new SandboxWorkerCrash(
			subgraphName,
			`subprocess exited (code ${code}) during init`,
		);
	});
	await Promise.race([ready, crashed]);
}

/** Get (or lazily spawn) the warm subprocess for a subgraph, re-`init`ing on
 *  a version change — the subprocess-pool mirror of `loadSubgraphDefinition`'s
 *  hot-reload contract. */
async function ensureSandboxProcess(
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
		// Version bump — re-init the existing warm subprocess in place
		// (cheaper than a respawn; spike doc §3.3 "hot-reload").
		try {
			await initSandboxProcess(
				existing.proc,
				subgraphName,
				version,
				handlerCode,
			);
			existing.version = version;
			logger.info("Sandbox subprocess handler reloaded", {
				subgraph: subgraphName,
				version,
			});
			return existing;
		} catch (err) {
			// Unhealthy subprocess — replace it below.
			existing.proc.kill();
			pool.delete(subgraphName);
			logger.warn("Sandbox subprocess re-init failed; respawning", {
				subgraph: subgraphName,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const proc = spawnSandboxProcess();
	try {
		await initSandboxProcess(proc, subgraphName, version, handlerCode);
	} catch (err) {
		proc.kill();
		throw err;
	}
	const entry: PoolEntry = { proc, version, chain: Promise.resolve() };
	pool.set(subgraphName, entry);
	return entry;
}

/** Terminate + drop a subgraph's warm subprocess. Wired into
 *  `invalidateSubgraphRoute` (`block-processor.ts`), so redeploys and
 *  deletions evict the subprocess on the same edge that drops the route
 *  cache. Name kept from the Worker-era API — the eviction semantics are
 *  identical, only the transport underneath changed. */
export function evictSandboxWorker(subgraphName: string): void {
	const entry = pool.get(subgraphName);
	if (!entry) return;
	entry.proc.kill();
	pool.delete(subgraphName);
}

/** Terminate the whole pool (graceful shutdown / test teardown). */
export function shutdownSandboxPool(): void {
	for (const name of [...pool.keys()]) evictSandboxWorker(name);
}

/**
 * Run one block's matched events through the subgraph's sandbox subprocess,
 * in place of the in-process `runHandlers(subgraph, matched, ctx)` call —
 * same inputs, same `{processed, errors}` result shape, same ctx left
 * holding the pending ops for the caller's unchanged `flush()` + outbox
 * flow.
 *
 * Membrane, per spike doc §3.2 (substrate updated by the Stage A addendum):
 * - the subprocess runs the REAL dispatch loop (`runHandlers`, imported by
 *   `subprocess-entry.ts`) over a `WorkerCtx`; writes buffer subprocess-side;
 * - `readRequest`s are answered here through `hostCtx`'s real
 *   `findOne`/`findMany`/aggregates. PRECISION NOTE (unchanged from Stage
 *   2a): this is equivalent to a raw base-DB read because `hostCtx`'s ops
 *   array is empty for the entire duration of the subprocess run — ops are
 *   only replayed onto it AFTER `blockDone` — and
 *   `overlayOne`/`overlayMany` short-circuit to the DB row unchanged when
 *   there are no pending ops. Reusing the real ctx read path (rather than
 *   hand-rolling raw SQL here) keeps SQL construction and `coerceRow`'s
 *   uint/int→BigInt coercion single-sourced with the in-process path; the
 *   subprocess overlays its own pending ops on the returned row,
 *   reconstructing exactly the in-process composition (raw read → coerce →
 *   overlay).
 * - on `blockDone` the subprocess's `(method, args, tx)` ops are replayed
 *   onto `hostCtx` by calling the real ctx methods (with `setTx` restoring
 *   each op's original tx attribution) — the single source of truth for op
 *   construction. The transaction never crosses the boundary.
 */
export async function runHandlersSandboxed(
	params: SandboxRunParams,
): Promise<RunResult> {
	const { subgraphName, version, handlerCode, hostCtx, block, matched } =
		params;
	const entry = await ensureSandboxProcess(subgraphName, version, handlerCode);

	// Serialize per-subprocess: chain this run behind any in-flight one.
	const run = entry.chain.then(() =>
		runBlockThroughProcess(entry, subgraphName, hostCtx, block, matched),
	);
	// The chain must survive a rejected run (the next block retries fresh).
	entry.chain = run.catch(() => undefined);
	return run;
}

async function runBlockThroughProcess(
	entry: PoolEntry,
	subgraphName: string,
	hostCtx: SubgraphContext,
	block: BlockMeta,
	matched: MatchedTx[],
): Promise<RunResult> {
	const { proc } = entry;

	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	let settled = false;

	try {
		const done = new Promise<{ ops: BufferedOp[]; result: RunResult }>(
			(resolve, reject) => {
				proc.setOnMessage((msg) => {
					if (msg.type === "readRequest") {
						answerRead(hostCtx, msg)
							.then((reply) => {
								proc.send({ type: "readResponse", id: msg.id, reply });
							})
							.catch((err) => {
								settled = true;
								reject(
									new SandboxWorkerCrash(
										subgraphName,
										`host read failed: ${err instanceof Error ? err.message : String(err)}`,
									),
								);
							});
						return;
					}
					if (msg.type === "blockDone") {
						settled = true;
						resolve({
							ops: msg.ops,
							result: { processed: msg.processed, errors: msg.errors },
						});
						return;
					}
					if (msg.type === "error") {
						settled = true;
						reject(new SandboxWorkerCrash(subgraphName, msg.message));
					}
				});
				proc.send({ type: "runBlock", block, matched });
			},
		);

		// A subprocess that dies mid-block (OOM, signal, uncaught exit) must
		// fail the block loudly, same as a timeout — guarded by `settled` so
		// this never fires after `done` already won the race, including long
		// after (when the subprocess eventually exits at pool shutdown).
		const crashed = proc.exited.then((code) => {
			if (settled) return undefined as never;
			throw new SandboxWorkerCrash(
				subgraphName,
				`subprocess exited unexpectedly (code ${code}) mid-block`,
			);
		});

		const deadline = new Promise<never>((_, reject) => {
			timeoutHandle = setTimeout(() => {
				settled = true;
				reject(
					new SandboxWorkerCrash(
						subgraphName,
						`block ${block.height} exceeded ${BLOCK_TIMEOUT_MS}ms deadline`,
					),
				);
			}, BLOCK_TIMEOUT_MS);
		});

		const { ops, result } = await Promise.race([done, crashed, deadline]);

		// End-of-block: replay the subprocess's decided ops through the REAL
		// ctx — real insert/upsert/increment/update/delete building the real
		// WriteOps (and eventually the real SQL at the caller's flush). setTx
		// restores each op's original tx attribution (context.ts captures
		// _tx_id at queue time, so replay must too).
		for (const op of ops) {
			hostCtx.setTx(op.tx);
			replayOp(hostCtx, op);
		}
		return result;
	} catch (err) {
		// Timeout, subprocess crash, or host-read failure: the subprocess's
		// state is suspect (it may still be running the old block) —
		// terminate + evict so the retry gets a fresh spawn. The thrown error
		// rolls back the caller's block transaction; processBlockWithRetry
		// retries as usual. A hung/crashed sandbox NEVER silently skips a
		// block's events — it fails the block (f040 B5 halt/retry semantics).
		evictSandboxWorker(subgraphName);
		logger.warn("Sandbox subprocess run failed; subprocess evicted", {
			subgraph: subgraphName,
			blockHeight: block.height,
			error: err instanceof Error ? err.message : String(err),
		});
		throw err;
	} finally {
		if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
		proc.setOnMessage(null);
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
