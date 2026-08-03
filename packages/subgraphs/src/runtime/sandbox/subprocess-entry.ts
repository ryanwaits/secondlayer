// f071 Stage A — code that runs INSIDE the sandbox OS subprocess.
//
// This is the subprocess port of `worker-entry.ts` (the disproven Bun
// `Worker` substrate — kept in place as `isolation.test.ts`'s regression
// lock, not deleted). Two trust levels, same split `worker-entry.ts`
// documented:
//   - THIS module is trusted harness code. It is launched directly as a
//     child process by the host (`host.ts`'s `spawnSandboxProcess`), stages
//     the bundled handler module to disk, and `import()`s it — mirroring
//     production's `loadSubgraphDefinition` flow (write `handler_code` to
//     disk, then dynamic `import()`).
//   - The HANDLER module it imports is untrusted. Its `node:*`/`bun:*`/bare
//     imports were rewritten to throw-on-evaluation stubs at bundle time,
//     host-side (`bundle.ts`), before the artifact reached this process.
//
// THE ENV SCRUB THAT ACTUALLY CONTAINS THE HANDLER IS NOT THIS TRANSPORT —
// it is `host.ts`'s `spawnSandboxProcess` spawning with an explicit,
// from-scratch env allowlist (PATH only; never `process.env` spread). That
// matters here specifically because this file runs as a REAL OS PROCESS, not
// a thread inside the host: `process.env` (bare or via `globalThis`),
// `Bun.env`, and anything THIS process spawns (`Bun.spawnSync`,
// `node:child_process`) all observe THIS process's own OS-level environ —
// the scrub the host set at spawn time — not the host's real environ. That
// is the exact physics change from the Bun `Worker` substrate (spike doc
// §10 / the Stage A addendum): a Worker is a thread in the host process, so
// `Bun.spawnSync` from inside it inherited the HOST's real environ
// regardless of the Worker's `env: {}`. `subprocess-isolation.test.ts`
// proves the difference empirically against this exact file.
//
// TRANSPORT CHOICE — Bun subprocess IPC, not hand-rolled stdio-JSONL:
// `Bun.spawn({ ipc, serialization: "advanced" })` (host side) / `process.send`
// + `process.on("message")` (this side) is Bun's built-in bun-to-bun IPC.
// "advanced" (the default) reuses the same JSC structured-clone codec
// `Worker.postMessage` used — including native BigInt support, which
// `protocol.ts`'s `BufferedOp.args` genuinely needs (a handler's
// `ctx.insert(table, { amount: 500n })` ships a real bigint across the
// boundary). A hand-rolled JSONL transport would need its own BigInt-safe
// codec (`JSON.stringify` throws on `bigint`) to carry the exact same
// messages `protocol.ts` already defines. IPC only works bun-to-bun, which
// is guaranteed here (`host.ts` always launches this file via
// `Bun.spawn([process.execPath, ...])`) — if that constraint ever needs to
// relax, the framing is isolated to this file's `post`/`process.on("message")`
// and `host.ts`'s `spawnSandboxProcess`, so swapping to stdio-JSONL later
// touches only those two functions, not `protocol.ts` or `worker-ctx.ts`.
//
// The event-dispatch loop is NOT re-implemented here: this process calls the
// REAL `runHandlers` (`runner.ts`) — the exact function the in-process path
// runs — against a `WorkerCtx` (`worker-ctx.ts`) instead of a
// `SubgraphContext`. Chain-order sort, filter lookup, payload building,
// per-event checkpoint/try/rollback (fix-f040 B6), and the error threshold
// are therefore byte-identical to the in-process path by construction — the
// only thing that changed is where `ctx`'s reads/writes land, and now, the
// process boundary they cross through to get there.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SubgraphDefinition } from "../../types.ts";
import type { SubgraphContext, TxMeta } from "../context.ts";
import { runHandlers } from "../runner.ts";
import type {
	HostToWorkerMessage,
	ReadMethod,
	ReadReply,
	WorkerToHostMessage,
} from "./protocol.ts";
import { WorkerCtx } from "./worker-ctx.ts";

function post(msg: WorkerToHostMessage): void {
	process.send?.(msg);
}

let def: SubgraphDefinition | null = null;
let version: string | null = null;

let reqId = 0;
const pendingReads = new Map<number, { resolve: (reply: ReadReply) => void }>();

function sendRead(
	method: ReadMethod,
	table: string,
	where: Record<string, unknown>,
	column?: string,
): Promise<ReadReply> {
	const id = ++reqId;
	return new Promise((resolve) => {
		pendingReads.set(id, { resolve });
		post({ type: "readRequest", id, method, table, where, column });
	});
}

async function loadBundle(bundledCode: string): Promise<SubgraphDefinition> {
	const dir = mkdtempSync(join(tmpdir(), "sg-sandbox-"));
	const file = join(dir, "handler.mjs");
	writeFileSync(file, bundledCode);
	const mod = await import(pathToFileURL(file).href);
	const loaded = (mod.default ?? mod) as SubgraphDefinition;
	if (!loaded || typeof loaded !== "object" || !loaded.handlers) {
		throw new Error(
			"sandbox subprocess: bundled handler module has no handlers",
		);
	}
	return loaded;
}

/** Same initial tx meta shape `block-processor.ts` constructs before
 *  `runHandlers` — the runner immediately `setTx`es per event, so this only
 *  ever stamps ops queued outside any event (which the runner never does). */
const INITIAL_TX: TxMeta = { txId: "", sender: "", type: "", status: "" };

process.on("message", async (raw: unknown) => {
	const msg = raw as HostToWorkerMessage;
	try {
		if (msg.type === "init") {
			def = await loadBundle(msg.bundledCode);
			version = msg.version;
			post({ type: "ready", version: msg.version });
			return;
		}
		if (msg.type === "readResponse") {
			const p = pendingReads.get(msg.id);
			if (p) {
				pendingReads.delete(msg.id);
				p.resolve(msg.reply);
			}
			return;
		}
		if (msg.type === "runBlock") {
			if (!def) throw new Error("sandbox subprocess: runBlock before init");
			const ctx = new WorkerCtx(
				msg.block,
				def.schema,
				{ ...INITIAL_TX },
				sendRead,
			);
			const t0 = performance.now();
			const result = await runHandlers(
				def,
				msg.matched,
				// The real dispatch loop against the worker proxy ctx — see the
				// file header (and worker-entry.ts's, verbatim) for why this cast
				// is sound.
				ctx as unknown as SubgraphContext,
			);
			post({
				type: "blockDone",
				ops: [...ctx.pendingOps],
				processed: result.processed,
				errors: result.errors,
				handlerMs: performance.now() - t0,
			});
			return;
		}
		if (msg.type === "shutdown") {
			process.exit(0);
		}
	} catch (err) {
		post({ type: "error", message: (err as Error).message });
	}
});

void version; // held for debugging/inspection; re-init overwrites it
