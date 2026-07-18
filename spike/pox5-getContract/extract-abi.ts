/**
 * st-013 Step 1: extract the pox-5 boot contract interface from Clarinet and
 * emit it as a TypeScript `AbiContract` literal.
 *
 * Run from packages/stacks:
 *   bun ../../spike/pox5-getContract/extract-abi.ts > ../../spike/pox5-getContract/pox5-abi.ts
 */
import { resolve } from "node:path";
import { initSimnet } from "@stacks/clarinet-sdk";

const MANIFEST = resolve(import.meta.dir, "../../contracts/Clarinet.toml");
const POX5_ID = "SP000000000000000000002Q6VF78.pox-5";

const simnet = await initSimnet(MANIFEST);
// biome-ignore lint/suspicious/noExplicitAny: clarinet interface JSON
const iface = simnet.getContractsInterfaces().get(POX5_ID) as any;
if (!iface) throw new Error(`pox-5 interface not found at ${POX5_ID}`);

// Clarinet's interface JSON wraps each function output as `outputs: { type }`;
// AbiContract wants `outputs: AbiType` directly. Everything else (args, maps,
// variables) already matches.
// Clarinet labels read-only functions "read_only", lists private functions,
// wraps outputs as `{ type }`, and spells buffer types `{ buffer: { length } }`
// where AbiType wants `{ buff: { length } }`. Remap all four.
// biome-ignore lint/suspicious/noExplicitAny: recursive type walk
function mapType(t: any): any {
	if (typeof t !== "object" || t === null) return t;
	if ("buffer" in t) return { buff: { length: t.buffer.length } };
	if ("buff" in t) return t;
	if ("list" in t)
		return { list: { type: mapType(t.list.type), length: t.list.length } };
	if ("optional" in t) return { optional: mapType(t.optional) };
	if ("response" in t)
		return {
			response: {
				ok: mapType(t.response.ok),
				error: mapType(t.response.error),
			},
		};
	if ("tuple" in t)
		return {
			// biome-ignore lint/suspicious/noExplicitAny: clarinet interface JSON
			tuple: t.tuple.map((f: any) => ({ name: f.name, type: mapType(f.type) })),
		};
	if ("string-ascii" in t || "string-utf8" in t) return t;
	return t;
}

const abi = {
	functions: iface.functions
		// biome-ignore lint/suspicious/noExplicitAny: clarinet interface JSON
		.filter((f: any) => f.access !== "private")
		// biome-ignore lint/suspicious/noExplicitAny: clarinet interface JSON
		.map((f: any) => ({
			name: f.name,
			access: f.access === "read_only" ? "read-only" : f.access,
			// biome-ignore lint/suspicious/noExplicitAny: clarinet interface JSON
			args: f.args.map((a: any) => ({ name: a.name, type: mapType(a.type) })),
			outputs: mapType(f.outputs.type ?? f.outputs),
		})),
	// biome-ignore lint/suspicious/noExplicitAny: clarinet interface JSON
	maps: (iface.maps ?? []).map((m: any) => ({
		name: m.name,
		key: mapType(m.key),
		value: mapType(m.value),
	})),
	// biome-ignore lint/suspicious/noExplicitAny: clarinet interface JSON
	variables: (iface.variables ?? []).map((v: any) => ({
		name: v.name,
		type: mapType(v.type),
		access: v.access,
	})),
};

const json = JSON.stringify(abi, null, "\t");

// Stats to stderr so stdout stays a clean TS module.
const pub = abi.functions.filter((f) => f.access === "public").length;
const ro = abi.functions.filter((f) => f.access === "read-only").length;
console.error(
	`functions: ${abi.functions.length} (${pub} public, ${ro} read-only) | maps: ${abi.maps.length} | variables: ${abi.variables.length} | json bytes: ${json.length}`,
);

// Collect the distinct type constructors used, to check AbiType coverage.
const typeKeys = new Set<string>();
// biome-ignore lint/suspicious/noExplicitAny: recursive walk
function walk(t: any): void {
	if (typeof t === "string") {
		typeKeys.add(t);
		return;
	}
	if (typeof t === "object" && t !== null) {
		for (const [k, v] of Object.entries(t)) {
			if (
				k === "list" ||
				k === "optional" ||
				k === "response" ||
				k === "tuple" ||
				k === "buff" ||
				k === "string-ascii" ||
				k === "string-utf8"
			) {
				typeKeys.add(k);
			}
			if (Array.isArray(v)) v.forEach(walk);
			else if (typeof v === "object") walk(v);
		}
	}
}
for (const f of iface.functions) {
	for (const a of f.args) walk(a.type);
	walk(f.outputs.type ?? f.outputs);
}
console.error(`distinct type constructors: ${[...typeKeys].sort().join(", ")}`);

console.log(`// Auto-extracted from Clarinet simnet (${POX5_ID}). st-013 spike.
import type { AbiContract } from "${
	import.meta.dir.includes("packages/stacks")
		? "./clarity/abi/contract.ts"
		: "../../packages/stacks/src/clarity/abi/contract.ts"
}";

export const POX5_ABI = ${json} as const satisfies AbiContract;
`);
