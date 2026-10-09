/**
 * Deterministic realm for verifiable (L2) subgraphs.
 *
 * Handlers run in a `node:vm` context whose global object is a frozen
 * allow-list: every forbidden global ({@link FORBIDDEN_GLOBALS}) is a getter
 * that throws {@link NondeterminismError}, `Math` keeps only exact members,
 * locale-sensitive methods throw, and code generation from strings is off.
 * The handler sees a `ctx` facade that rejects non-integer numbers in rows,
 * refuses concurrent ctx calls, and turns read failures into block aborts.
 *
 * This is a determinism guard, not a security boundary: a handler can still
 * reach host intrinsics through the objects it is handed. The deploy scan
 * and this realm together catch accidental nondeterminism; hostile code is
 * gVisor's job.
 *
 * Only subgraphs whose stored verification says `verifiable` load here.
 * Everything else keeps the plain `import()` path, unchanged.
 */
import vm from "node:vm";
import type {
	SubgraphContext,
	SubgraphDefinition,
	SubgraphSchema,
} from "../types.ts";
import {
	ALLOWED_GLOBALS,
	ALLOWED_MATH,
	FORBIDDEN_GLOBALS,
	LOCALE_METHODS,
} from "../verification.ts";

/**
 * A handler broke the determinism contract at runtime. Infra-class: the
 * block aborts (rollback + retry) instead of skipping the event, because a
 * skip would commit output that depends on the run.
 */
export class NondeterminismError extends Error {
	override name = "NondeterminismError";
}

/**
 * A ctx read (DB, chain) failed under a verifiable subgraph. Infra-class like
 * {@link NondeterminismError}: skipping the event would make its rows depend
 * on whether the database was reachable.
 */
export class HandlerReadError extends Error {
	override name = "HandlerReadError";
}

/** Errors that abort the whole block rather than skip one event. */
export function abortsBlock(err: unknown): boolean {
	return err instanceof NondeterminismError || err instanceof HandlerReadError;
}

/** Host constructors handed to the realm so `x instanceof Uint8Array` holds
 *  for decoded event payloads, which are built in the host realm. */
const HOST_GLOBALS = [
	"ArrayBuffer",
	"DataView",
	"Int8Array",
	"Uint8Array",
	"Uint8ClampedArray",
	"Int16Array",
	"Uint16Array",
	"Int32Array",
	"Uint32Array",
	"Float16Array",
	"Float32Array",
	"Float64Array",
	"BigInt64Array",
	"BigUint64Array",
	"TextEncoder",
	"TextDecoder",
	"atob",
	"btoa",
] as const;

function forbid(name: string, reason: string): () => never {
	return () => {
		throw new NondeterminismError(`${name}: ${reason}`);
	};
}

function createRealm(): vm.Context {
	const host = globalThis as unknown as Record<string, unknown>;
	const sandbox: Record<string, unknown> = Object.create(null);
	for (const name of HOST_GLOBALS) {
		if (host[name] !== undefined) sandbox[name] = host[name];
	}
	const context = vm.createContext(sandbox, {
		name: "subgraph-handler",
		codeGeneration: { strings: false, wasm: false },
	});
	const g = vm.runInContext("globalThis", context) as Record<string, unknown>;

	const allowed = new Set(ALLOWED_GLOBALS);
	for (const name of Object.getOwnPropertyNames(g)) {
		if (!allowed.has(name)) delete g[name];
	}
	for (const [name, reason] of Object.entries(FORBIDDEN_GLOBALS)) {
		Object.defineProperty(g, name, { get: forbid(name, reason) });
	}

	const realmMath = g.Math as Record<string, unknown>;
	const safeMath: Record<string, unknown> = {};
	const allowedMath = new Set(ALLOWED_MATH);
	for (const key of Object.getOwnPropertyNames(realmMath)) {
		if (allowedMath.has(key)) safeMath[key] = realmMath[key];
		else
			Object.defineProperty(safeMath, key, {
				get: forbid(
					`Math.${key}`,
					key === "random"
						? "randomness differs per run"
						: "result is engine-approximated",
				),
			});
	}
	Object.defineProperty(g, "Math", { value: Object.freeze(safeMath) });

	for (const ctor of ["String", "Number", "BigInt", "Array", "Object"]) {
		const proto = (g[ctor] as { prototype: object }).prototype;
		for (const method of LOCALE_METHODS) {
			if (Object.prototype.hasOwnProperty.call(proto, method)) {
				Object.defineProperty(proto, method, {
					value: forbid(method, "output depends on the host's locale data"),
				});
			}
		}
	}

	// No new globals. Not Object.freeze: under Bun, freezing (or redefining
	// every binding of) a vm global breaks lookups of its built-ins. Forbidden
	// getters and Math are already non-configurable, so they stay locked.
	Object.preventExtensions(g);
	return context;
}

// ── ctx facade ──────────────────────────────────────────────────────────

/** Reject row values whose stored form can differ across engines or runs. */
export function checkRowValues(
	where: string,
	values: Record<string, unknown>,
): void {
	for (const [col, value] of Object.entries(values)) {
		checkValue(value, `${where}.${col}`);
	}
}

function checkValue(value: unknown, path: string): void {
	switch (typeof value) {
		case "number":
			if (!Number.isSafeInteger(value)) {
				throw new TypeError(
					`${path}: ${value} is not a safe integer; verifiable subgraphs store bigint or integers only`,
				);
			}
			return;
		case "function":
		case "symbol":
			throw new TypeError(`${path}: a ${typeof value} is not a row value`);
		case "object":
			if (value === null || ArrayBuffer.isView(value)) return;
			if (Array.isArray(value)) {
				value.forEach((v, i) => checkValue(v, `${path}[${i}]`));
				return;
			}
			for (const [k, v] of Object.entries(value)) checkValue(v, `${path}.${k}`);
			return;
		default:
			return;
	}
}

/**
 * Wrap the runtime ctx for one block. Reads must be awaited one at a time:
 * a second ctx call while a read is pending would order writes by database
 * latency.
 */
export function deterministicContext(
	ctx: SubgraphContext,
	schema: SubgraphSchema,
): SubgraphContext {
	let pendingReads = 0;
	// An unknown table is the handler's bug, identical on every run: keep it
	// handler-origin (event skipped) rather than a read failure (block abort).
	const knownTable = (table: string) => {
		if (!Object.prototype.hasOwnProperty.call(schema, table)) {
			throw new Error(`Table "${table}" not found in subgraph schema`);
		}
	};
	const guard = (op: string) => {
		if (pendingReads > 0) {
			throw new NondeterminismError(
				`ctx.${op} while a ctx read is pending: concurrent ctx calls order writes by database latency; await each read before the next call`,
			);
		}
	};
	const read = async <T>(op: string, run: () => Promise<T>): Promise<T> => {
		guard(op);
		pendingReads++;
		try {
			return await run();
		} catch (err) {
			if (err instanceof NondeterminismError) throw err;
			throw new HandlerReadError(
				`ctx.${op} failed: ${err instanceof Error ? err.message : String(err)}`,
				{ cause: err },
			);
		} finally {
			pendingReads--;
		}
	};
	type FindMany = (...args: unknown[]) => Promise<Record<string, unknown>[]>;
	return {
		get block() {
			return ctx.block;
		},
		get tx() {
			return ctx.tx;
		},
		get client(): never {
			throw new NondeterminismError(
				"ctx.client: contract reads need L3 proofs",
			);
		},
		insert(table, row) {
			guard("insert");
			checkRowValues(`insert ${table}`, row);
			ctx.insert(table, row);
		},
		update(table, where, set) {
			guard("update");
			checkRowValues(`update ${table}`, where);
			checkRowValues(`update ${table}`, set);
			ctx.update(table, where, set);
		},
		upsert(table, key, row) {
			guard("upsert");
			checkRowValues(`upsert ${table}`, key);
			checkRowValues(`upsert ${table}`, row);
			ctx.upsert(table, key, row);
		},
		delete(table, where) {
			guard("delete");
			ctx.delete(table, where);
		},
		increment(table, key, deltas) {
			guard("increment");
			checkRowValues(`increment ${table}`, key);
			checkRowValues(`increment ${table}`, deltas);
			ctx.increment(table, key, deltas);
		},
		findOne: (table, where) => {
			knownTable(table);
			return read("findOne", () => ctx.findOne(table, where));
		},
		findMany: (table, ...rest: unknown[]) => {
			knownTable(table);
			return read("findMany", () => (ctx.findMany as FindMany)(table, ...rest));
		},
	};
}

// ── Loading ─────────────────────────────────────────────────────────────

/**
 * Evaluate a bundled handler (ESM, as stored in `handler_code`) inside a
 * fresh deterministic realm and return its definition with every handler
 * wrapped to receive the {@link deterministicContext} facade.
 */
export async function loadDeterministicDefinition(
	handlerCode: string,
): Promise<SubgraphDefinition> {
	// The realm runs scripts, not modules: lower the bundle's single
	// `export default` to CommonJS. Bundles have no imports left to resolve.
	// Loaded lazily so importing the runner never pulls esbuild.
	const { transform } = await import("esbuild");
	const { code } = await transform(handlerCode, {
		format: "cjs",
		loader: "js",
		logLevel: "silent",
	});
	const context = createRealm();
	const evaluate = vm.runInContext(
		`(function (module, exports) {\n${code}\n})`,
		context,
		{ filename: "handler.js" },
	) as (module: { exports: unknown }, exports: unknown) => void;
	const mod: { exports: Record<string, unknown> } = { exports: {} };
	evaluate(mod, mod.exports);
	const def = (mod.exports.default ?? mod.exports) as SubgraphDefinition;
	// Declarative parts cross back as host objects, so runtime code never
	// sees realm prototypes.
	const sources = structuredClone(def.sources);
	const schema = structuredClone(def.schema);

	// One facade per block context (the runner builds a fresh ctx per block).
	const facades = new WeakMap<SubgraphContext, SubgraphContext>();
	const handlers: SubgraphDefinition["handlers"] = {};
	for (const [name, handler] of Object.entries(def.handlers ?? {})) {
		handlers[name] = (event, ctx) => {
			let facade = facades.get(ctx);
			if (!facade) {
				facade = deterministicContext(ctx, schema);
				facades.set(ctx, facade);
			}
			return handler(event, facade);
		};
	}
	return { ...def, sources, schema, handlers };
}
