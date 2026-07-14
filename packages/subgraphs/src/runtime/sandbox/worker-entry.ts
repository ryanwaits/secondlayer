// f071 Stage 2a — code that runs INSIDE the sandbox Bun Worker.
//
// Two trust levels in this file, same split the f060 PoC demonstrated:
//   - THIS module is trusted harness code, loaded by the host via
//     `new Worker(..., { env: {} })`. It may use node:fs to stage the
//     bundled handler on disk before importing it — mirroring production's
//     own `loadSubgraphDefinition` flow (`processor.ts`: write
//     `handler_code` to disk, then dynamic `import()`).
//   - The HANDLER module it imports is untrusted. Its `node:*`/`bun:*`/bare
//     imports were rewritten to throw-on-evaluation stubs at bundle time,
//     host-side (`bundle.ts`), before the artifact reached this worker. The
//     env scrub (`env: {}` at Worker construction — a real OS-level
//     boundary, not a JS `process.env` mutation) is what keeps
//     `SECONDLAYER_SECRETS_KEY` and every other host env var unreadable
//     from in here; `isolation.test.ts` locks that in.
//
// The event-dispatch loop is NOT re-implemented here: the worker calls the
// REAL `runHandlers` (`runner.ts`) — the exact function the in-process path
// runs — against a `WorkerCtx` (`worker-ctx.ts`) instead of a
// `SubgraphContext`. Chain-order sort, filter lookup, payload building,
// per-event checkpoint/try/rollback (fix-f040 B6), and the error threshold
// are therefore byte-identical to the in-process path by construction —
// the only thing that changed is where `ctx`'s reads/writes land.
// `runHandlers` only touches the ctx surface `WorkerCtx` fully implements
// (`setTx`/`opsCheckpoint`/`rollbackTo` + the handler-facing methods), so
// the cast below is sound; `overlay-parity.test.ts` guards the read/write
// semantics behind it.
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
	// biome-ignore lint/suspicious/noExplicitAny: Bun Worker global postMessage
	(postMessage as any)(msg);
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
		throw new Error("sandbox worker: bundled handler module has no handlers");
	}
	return loaded;
}

/** Same initial tx meta shape `block-processor.ts` constructs before
 *  `runHandlers` — the runner immediately `setTx`es per event, so this only
 *  ever stamps ops queued outside any event (which the runner never does). */
const INITIAL_TX: TxMeta = { txId: "", sender: "", type: "", status: "" };

// biome-ignore lint/suspicious/noExplicitAny: Bun Worker global onmessage
(globalThis as any).onmessage = async (e: { data: HostToWorkerMessage }) => {
	const msg = e.data;
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
			if (!def) throw new Error("sandbox worker: runBlock before init");
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
				// file header for why this cast is sound.
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
};

void version; // held for debugging/inspection; re-init overwrites it
