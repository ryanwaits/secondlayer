// f060 SPIKE — code that runs INSIDE the Bun Worker.
//
// Two trust levels in this one file, which is the whole point of the demo:
//   - THIS module (worker-entry.ts) is trusted harness code, loaded by the
//     host via `new Worker(...)`. It's allowed to use node:fs/os/path to
//     stage the bundled handler on disk before importing it — mirrors
//     production's own handlerImportUrl flow (processor.ts:120-128), which
//     also writes handler_code to disk before `import()`ing it.
//   - The HANDLER module it then imports (bundled by bundle.ts, host-side,
//     BEFORE being handed to this worker) is untrusted. Its node:*/bare
//     imports were already rewritten to throw-on-eval stubs at bundle time
//     (bundle.ts's resolverLockdownPlugin) — this file does not re-implement
//     that lockdown, it only demonstrates the env side of the boundary
//     (env: {} at Worker-construction time, see host.ts) by simply NOT
//     forwarding any secret into this process's environment.
//
// The ctx object handed to the imported handler is the "membrane": writes
// (insert/upsert/increment/update/delete) are pushed to a local buffer with
// ZERO round trip — they're synchronous in the real SubgraphContext too
// (context.ts:125-245), no I/O happens until flush(). Reads (findOne/
// findMany) message-pass to the host, which holds the real open transaction,
// and await a reply — this is the real async shape `ctx.findOne` already has
// in production (context.ts:298-313), preserved across the boundary.
//
// Read-your-writes (context.ts:67) is reconstructed here for the ONE pattern
// both demo handlers use — an increment on the exact key just read. A real
// port would share context.ts's overlayOne/overlayMany/applyOpToRow verbatim
// (pure data transformation, no I/O, no secrets — safe to duplicate into the
// worker bundle); this PoC hand-rolls the increment case only and says so.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	BufferedOp,
	HandlerKind,
	HostToWorkerMessage,
	WorkerToHostMessage,
} from "./protocol.ts";

function post(msg: WorkerToHostMessage): void {
	// biome-ignore lint/suspicious/noExplicitAny: Bun Worker global postMessage
	(postMessage as any)(msg);
}

let handlerFn:
	| ((payload: unknown, ctx: unknown) => unknown)
	| (() => Promise<unknown>)
	| null = null;
let handlerKind: HandlerKind | null = null;

let reqId = 0;
const pending = new Map<
	number,
	{ resolve: (row: Record<string, unknown> | null) => void }
>();
const readRoundTripMs: number[] = [];
let localOps: BufferedOp[] = [];

function sendRead(
	method: "findOne" | "findMany",
	table: string,
	where: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
	const id = ++reqId;
	const t0 = performance.now();
	return new Promise((resolve) => {
		pending.set(id, {
			resolve: (row) => {
				readRoundTripMs.push(performance.now() - t0);
				resolve(row);
			},
		});
		post({ type: "readRequest", id, method, table, where });
	});
}

/** Overlay locally-buffered `increment` ops onto a base row for the exact-key
 *  case (see file header — not a full port of context.ts's overlay). */
function overlayIncrements(
	table: string,
	where: Record<string, unknown>,
	base: Record<string, unknown> | null,
): Record<string, unknown> | null {
	let row = base;
	for (const op of localOps) {
		if (op.table !== table || op.method !== "increment") continue;
		const [key, deltas] = op.args as [
			Record<string, unknown>,
			Record<string, bigint | number>,
		];
		const sameKey = Object.keys(where).every(
			(k) => String(key[k]) === String(where[k]),
		);
		if (!sameKey) continue;
		if (row) {
			const merged = { ...row };
			for (const [col, d] of Object.entries(deltas)) {
				merged[col] =
					BigInt((merged[col] as bigint | number | undefined) ?? 0n) +
					BigInt(d);
			}
			row = merged;
		} else {
			const created: Record<string, unknown> = { ...key };
			for (const [col, d] of Object.entries(deltas)) created[col] = BigInt(d);
			row = created;
		}
	}
	return row;
}

// The membrane handed to the imported handler — the sandbox's ENTIRE
// capability surface. No `process`, no `fetch` handed in explicitly (though
// the module scope still has ambient `process`/`fetch`/`import` globals —
// that's exactly what env-scrub + resolver-lockdown must cover, see the
// isolation demo in the "hostile" handler kind).
const ctx = {
	async findOne(table: string, where: Record<string, unknown>) {
		const row = await sendRead("findOne", table, where);
		return overlayIncrements(table, where, row);
	},
	async findMany(_table: string, _where: Record<string, unknown>) {
		// Not exercised by the two demo handlers — omitted from this PoC's
		// scope; a real port needs the findMany overlay too (context.ts:353-391).
		throw new Error("f060 PoC: findMany overlay not implemented");
	},
	insert(table: string, row: Record<string, unknown>) {
		localOps.push({ method: "insert", table, args: [row] });
	},
	upsert(
		table: string,
		key: Record<string, unknown>,
		row: Record<string, unknown>,
	) {
		localOps.push({ method: "upsert", table, args: [key, row] });
	},
	increment(
		table: string,
		key: Record<string, unknown>,
		deltas: Record<string, bigint | number>,
	) {
		localOps.push({ method: "increment", table, args: [key, deltas] });
	},
	update(
		table: string,
		where: Record<string, unknown>,
		set: Record<string, unknown>,
	) {
		localOps.push({ method: "update", table, args: [where, set] });
	},
	delete(table: string, where: Record<string, unknown>) {
		localOps.push({ method: "delete", table, args: [where] });
	},
};

async function loadHandler(bundledCode: string): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "f060-worker-"));
	const file = join(dir, "handler.mjs");
	writeFileSync(file, bundledCode);
	const mod = await import(pathToFileURL(file).href);
	// biome-ignore lint/suspicious/noExplicitAny: dynamically loaded, shape validated by convention (default export)
	handlerFn = (mod.default ?? mod) as any;
}

// biome-ignore lint/suspicious/noExplicitAny: Bun Worker global onmessage
(globalThis as any).onmessage = async (e: { data: HostToWorkerMessage }) => {
	const msg = e.data;
	try {
		if (msg.type === "init") {
			handlerKind = msg.handlerKind;
			await loadHandler(msg.bundledCode);
			post({ type: "ready" });
			return;
		}
		if (msg.type === "readResponse") {
			const p = pending.get(msg.id);
			if (p) {
				pending.delete(msg.id);
				p.resolve(msg.row);
			}
			return;
		}
		if (msg.type === "runBlock") {
			if (!handlerFn) throw new Error("handler not loaded");
			localOps = [];
			readRoundTripMs.length = 0;
			let errors = 0;
			const t0 = performance.now();
			for (const ev of msg.events) {
				// Per-EVENT checkpoint/rollback — the worker-side mirror of
				// runner.ts:446/497 (`ctx.opsCheckpoint()` / `ctx.rollbackTo(...)`,
				// fix-f040 B6). A handler that throws mid-way must contribute
				// NOTHING to the ops it eventually sends the host; otherwise a
				// partial write (e.g. one leg of a two-leg transfer) would flush.
				// Pure array bookkeeping — no I/O, no secrets — same as the real
				// SubgraphContext.opsCheckpoint()/rollbackTo() (context.ts:249-263).
				const checkpoint = localOps.length;
				try {
					// biome-ignore lint/suspicious/noExplicitAny: payload shape is handler-kind-specific
					await (handlerFn as any)(ev, ctx);
				} catch {
					localOps.length = checkpoint;
					errors++;
				}
			}
			const handlerMs = performance.now() - t0;
			post({
				type: "blockDone",
				blockHeight: msg.blockHeight,
				ops: localOps,
				handlerMs,
				readRoundTripMs: [...readRoundTripMs],
				errors,
			});
			return;
		}
		if (msg.type === "runHostile") {
			if (!handlerFn) throw new Error("handler not loaded");
			// biome-ignore lint/suspicious/noExplicitAny: hostile handler takes no args
			const report = (await (handlerFn as any)()) as Record<string, unknown>;
			post({ type: "hostileReport", report });
			return;
		}
		if (msg.type === "shutdown") {
			process.exit(0);
		}
	} catch (err) {
		post({ type: "error", message: (err as Error).message });
	}
};

void handlerKind; // referenced for clarity/debugging; not otherwise used yet
