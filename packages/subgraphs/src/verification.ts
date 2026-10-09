/**
 * Verifiable subgraphs: the determinism contract, the derived level and the
 * pin. Pure (node:crypto only) so the bundler's deploy scan, the API and the
 * runtime realm all read the same rules.
 *
 * A subgraph is never configured as verifiable. Its level is derived from
 * its sources plus a scan of the bundled handler, and only a subgraph whose
 * every input is provable today (`state`: named state writes) has the contract
 * enforced. Everything else gets the same findings as advice.
 */
import { createHash } from "node:crypto";
import type { SubgraphVerification } from "@secondlayer/shared/schemas/subgraphs";
import pkg from "../package.json" with { type: "json" };
import type { SubgraphDefinition, SubgraphFilter } from "./types.ts";

export type { SubgraphVerification };

/** Runtime identity baked into every pin: matcher, decode and flush semantics. */
export const SUBGRAPHS_RUNTIME: string = `@secondlayer/subgraphs@${pkg.version}`;

// ── Determinism contract ────────────────────────────────────────────────

/**
 * Globals a handler may not touch, with the reason shown to the developer.
 * The deploy scan reports them; the realm replaces each with a getter that
 * throws `NondeterminismError`.
 */
export const FORBIDDEN_GLOBALS: Readonly<Record<string, string>> = {
	Date: "wall-clock time differs per run",
	performance: "timers differ per run",
	process: "host environment differs per run",
	fetch: "network reads are not chain inputs",
	crypto: "randomness differs per run",
	setTimeout: "scheduling order differs per run",
	setInterval: "scheduling order differs per run",
	setImmediate: "scheduling order differs per run",
	clearTimeout: "scheduling order differs per run",
	clearInterval: "scheduling order differs per run",
	queueMicrotask: "scheduling order differs per run",
	WeakRef: "garbage collection timing differs per run",
	FinalizationRegistry: "garbage collection timing differs per run",
	Atomics: "shared memory is not single-threaded",
	SharedArrayBuffer: "shared memory is not single-threaded",
	Intl: "locale and time zone data differ per host",
	Temporal: "locale and time zone data differ per host",
	eval: "generated code hides inputs from the scan",
	WebAssembly: "compiled code hides inputs from the scan",
	ShadowRealm: "a nested realm escapes the allow-list",
	require: "imports must be bundled into the handler",
};

/**
 * Globals a handler may use: ECMAScript built-ins whose results are fully
 * specified, plus deterministic host encoders. `Math` is narrowed separately
 * ({@link ALLOWED_MATH}).
 */
export const ALLOWED_GLOBALS: readonly string[] = [
	"undefined",
	"NaN",
	"Infinity",
	"globalThis",
	"isNaN",
	"isFinite",
	"parseInt",
	"parseFloat",
	"decodeURI",
	"decodeURIComponent",
	"encodeURI",
	"encodeURIComponent",
	"escape",
	"unescape",
	"Object",
	"Function",
	"Array",
	"Number",
	"Boolean",
	"String",
	"Symbol",
	"BigInt",
	"Math",
	"JSON",
	"Reflect",
	"Proxy",
	"Promise",
	"Map",
	"Set",
	"WeakMap",
	"WeakSet",
	"RegExp",
	"Iterator",
	"DisposableStack",
	"AsyncDisposableStack",
	"Error",
	"AggregateError",
	"SuppressedError",
	"EvalError",
	"RangeError",
	"ReferenceError",
	"SyntaxError",
	"TypeError",
	"URIError",
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
	"console",
];

/** `Math` members whose results are exact on every engine. The rest
 *  (`sin`, `pow`, `log`, …) are implementation-approximated. */
export const ALLOWED_MATH: readonly string[] = [
	"abs",
	"min",
	"max",
	"floor",
	"ceil",
	"trunc",
	"sign",
	"round",
	"E",
	"LN10",
	"LN2",
	"LOG10E",
	"LOG2E",
	"PI",
	"SQRT1_2",
	"SQRT2",
];

/** Methods whose output depends on the host's locale data. */
export const LOCALE_METHODS: readonly string[] = [
	"toLocaleString",
	"toLocaleDateString",
	"toLocaleTimeString",
	"toLocaleUpperCase",
	"toLocaleLowerCase",
	"localeCompare",
];

/**
 * One thing the deploy scan found in a bundled handler.
 *
 * - `nondeterministic`: breaks the determinism contract. Fails the deploy of
 *   a state subgraph; advice for everything else.
 * - `needs-events`: deterministic, but reads something only re-execution proofs cover
 *   (`ctx.client`). Raises the level instead of failing.
 */
export interface HandlerFinding {
	kind: "nondeterministic" | "needs-events";
	/** What was used, e.g. `Date`, `Math.random`, `import()`, `ctx.client`. */
	name: string;
	reason: string;
	/** Original source file when a sourcemap was available, else the bundle. */
	file: string;
	/** 1-based. */
	line: number;
	/** 1-based. */
	column: number;
}

export function formatFinding(f: HandlerFinding): string {
	return `${f.file}:${f.line}:${f.column} ${f.name}: ${f.reason}`;
}

// ── Derived level ───────────────────────────────────────────────────────

/**
 * Sources whose every field is a named state write: provable per block from
 * the header-backed witness plus `state_writes`. Not `map_insert`: storage
 * holds `(some v)` for an insert and a set alike, so telling them apart takes
 * re-execution (event proofs).
 */
const STATE_SOURCE_TYPES: ReadonlySet<string> = new Set([
	"var_set",
	"map_set",
	"map_delete",
]);

const LEVEL_RANK = { state: 0, events: 1, none: 2 } as const;

/** Handler findings listed in `reasons`; the rest are counted. */
const MAX_LISTED_FINDINGS = 10;

/**
 * Derive how far a subgraph's rows can be checked. Level = the highest any
 * source or handler read needs. `reasons` lists everything standing between
 * the subgraph and checkable rows; a `state` subgraph with any reason is
 * refused at deploy, so every stored `state` row has none. Never configured,
 * never a flag.
 */
export function deriveVerification(
	def: Pick<SubgraphDefinition, "sources" | "backfillMode">,
	findings: readonly HandlerFinding[] = [],
): SubgraphVerification {
	let level: keyof typeof LEVEL_RANK = "state";
	const raise = (to: keyof typeof LEVEL_RANK) => {
		if (LEVEL_RANK[to] > LEVEL_RANK[level]) level = to;
	};
	const reasons: string[] = [];

	for (const [name, source] of Object.entries(def.sources ?? {})) {
		const filter = source as SubgraphFilter & { trait?: string };
		if (filter.trait) {
			raise("none");
			reasons.push(
				`source "${name}": trait scope needs a proven contract registry`,
			);
		} else if (filter.type === "map_insert") {
			raise("events");
			reasons.push(
				`map_insert source "${name}": map_insert vs map_set needs event proofs`,
			);
		} else if (!STATE_SOURCE_TYPES.has(filter.type)) {
			raise("events");
			reasons.push(`${filter.type} source "${name}" needs event proofs`);
		}
	}
	if (def.backfillMode === "concurrent") {
		raise("none");
		reasons.push("backfillMode concurrent: tip-first order is not chain order");
	}
	if (findings.some((f) => f.kind === "needs-events")) raise("events");
	// A large bundled library can trip dozens of findings; list a few.
	for (const f of findings.slice(0, MAX_LISTED_FINDINGS)) {
		reasons.push(
			f.kind === "needs-events"
				? `${formatFinding(f)} (needs event proofs)`
				: formatFinding(f),
		);
	}
	if (findings.length > MAX_LISTED_FINDINGS) {
		reasons.push(
			`…and ${findings.length - MAX_LISTED_FINDINGS} more handler findings`,
		);
	}

	return {
		level,
		reasons,
		unproven:
			reasons.length === 0
				? [
						"tx attribution of writes: event.tx, _tx_id (needs event proofs)",
						"intermediate writes within a block (needs event proofs)",
					]
				: [],
	};
}

/**
 * True when the deploy must be refused: the sources are provable (`state`), so
 * the determinism contract is enforced, and the scan broke it.
 */
export function isDeterminismViolation(v: SubgraphVerification): boolean {
	return v.level === "state" && v.reasons.length > 0;
}

// ── Pin ─────────────────────────────────────────────────────────────────

export interface PinInput {
	/** Existing `schema_hash` (name + schema + sources). */
	schemaHash: string;
	/** Bundled ESM exactly as stored in `subgraphs.handler_code`. */
	handlerCode: string;
	startBlock?: number | null;
	network: string;
	/** Defaults to {@link SUBGRAPHS_RUNTIME}. */
	runtime?: string;
}

function sha256(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

/**
 * Content hash over everything that shapes a subgraph's rows. Unlike
 * `schema_hash`, it changes with the handler, `startBlock` and runtime, so
 * two deploys with the same pin produce the same rows from the same chain.
 */
export function computePin(input: PinInput): string {
	// Canonical JSON: fixed key order, primitives only.
	const canonical = JSON.stringify({
		handlerHash: sha256(input.handlerCode),
		network: input.network,
		runtime: input.runtime ?? SUBGRAPHS_RUNTIME,
		schemaHash: input.schemaHash,
		startBlock: input.startBlock ?? null,
	});
	return sha256(canonical);
}
