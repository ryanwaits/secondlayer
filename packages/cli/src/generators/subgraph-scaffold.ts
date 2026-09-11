import {
	generateTokenSubgraphFromAbi,
	generateTraitSubgraph,
} from "@secondlayer/scaffold";
import type { AbiContract, SipStandard } from "@secondlayer/stacks/clarity";
import { toCamelCase } from "@secondlayer/stacks/clarity";
import { formatCode } from "../utils/format.ts";
import { clarityTypeToSubgraphColumn } from "./clarity-to-subgraph.ts";

export type ScaffoldTrait = SipStandard;

export interface SubgraphScaffoldInput {
	/** Full contract identifier, e.g. SP….contract-name (omit for `--trait`). */
	contractId?: string;
	/** Full contract ABI (used to detect the SIP standard + asset name). */
	abi?: AbiContract;
	/** Subgraph name (defaults to the contract name). */
	subgraphName?: string;
	/** Restrict contract_call indexing to these function names (typed per-fn tables). */
	functions?: string[];
	/** Trait-scoped scaffold: index every contract conforming to this standard. */
	trait?: ScaffoldTrait;
	/** With --trait: track balances via ctx.increment (FT only). */
	balances?: boolean;
}

function snake(str: string): string {
	return str.replace(/-/g, "_");
}

function wrap(
	name: string,
	sources: string,
	schema: string,
	handlers: string,
	/** Emitted above the definition — the `as const` ABI that types `event.input`. */
	preamble = "",
): string {
	return `
import { defineSubgraph } from '@secondlayer/subgraphs';
${preamble}
export default defineSubgraph({
  name: '${name}',
  sources: {
${sources}
  },
  schema: {
${schema}
  },
  handlers: {
${handlers}
  }
});
`.trimStart();
}

/**
 * Emit the `as const` ABI the scaffolded sources reference. `as const` is what
 * makes `event.input` typed: `ContractCallPayload` reads the literal arg names
 * and Clarity types off it via `ExtractFunctionArgs`. Trimmed to the scaffolded
 * functions so the file stays readable — nothing else is needed for typing.
 */
function abiConstant(fns: AbiContract["functions"]): string {
	const json = JSON.stringify({ functions: fns }, null, 2)
		.replace(/"([a-zA-Z_$][a-zA-Z0-9_$-]*)":/g, (match, key: string) =>
			/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? `${key}:` : match,
		)
		.replace(/"/g, "'")
		.split("\n")
		.join("\n");
	return `
/** Trimmed contract ABI — \`as const\` is what types \`event.input\`. */
const abi = ${json} as const;
`;
}

/** Single generic calls table for a non-token contract. */
function genericCallsScaffold(name: string, contractId: string): string {
	return wrap(
		name,
		`    calls: { type: 'contract_call', contractId: '${contractId}' }`,
		`    calls: {
      columns: {
        function_name: { type: 'text', indexed: true },
        sender: { type: 'principal' },
        args: { type: 'jsonb' }
      }
    }`,
		`    calls: (event, ctx) => {
      ctx.insert('calls', { function_name: event.functionName, sender: event.sender, args: { values: event.args } });
    }`,
	);
}

/** Typed table per allowlisted public function (positional arg decode). */
function functionsScaffold(
	name: string,
	contractId: string,
	abi: AbiContract,
	fnNames: string[],
): string {
	const fns = abi.functions.filter(
		(f) => f.access === "public" && fnNames.includes(f.name),
	);
	if (fns.length === 0) {
		throw new Error(
			`none of --functions [${fnNames.join(", ")}] are public functions of ${contractId}`,
		);
	}
	// `abi` on the source is what makes `event.input` the named, typed,
	// decoded arguments — without it the handler is stuck with positional
	// `event.args[i]` and an unchecked cast.
	const sources = fns
		.map(
			(f) =>
				`    ${toCamelCase(f.name)}: { type: 'contract_call', contractId: '${contractId}', functionName: '${f.name}', abi }`,
		)
		.join(",\n");
	const schema = fns
		.map((f) => {
			const cols = f.args
				// biome-ignore lint/suspicious/noExplicitAny: ABI arg type is dynamic
				.map((arg: { name: string; type: any }) => {
					const m = clarityTypeToSubgraphColumn(arg.type);
					return `        ${snake(arg.name)}: { type: '${m.type}'${m.nullable ? ", nullable: true" : ""} }`;
				})
				.join(",\n");
			return `    ${snake(f.name)}: {\n      columns: {\n${cols || "        sender: { type: 'principal' }"}\n      }\n    }`;
		})
		.join(",\n");
	const handlers = fns
		.map((f) => {
			// Named and typed off the ABI — no positional index, no cast.
			const inserts = f.args
				.map(
					(arg: { name: string }) =>
						`${snake(arg.name)}: event.input.${toCamelCase(arg.name)}`,
				)
				.join(", ");
			return `    ${toCamelCase(f.name)}: (event, ctx) => {\n      ctx.insert('${snake(f.name)}', { ${inserts} });\n    }`;
		})
		.join(",\n\n");
	return wrap(name, sources, schema, handlers, abiConstant(fns));
}

/**
 * Generate a `defineSubgraph()` file. Standard-aware: a SIP-010 contract scaffolds
 * an `ft_transfer` source (the useful "index this token" shape), SIP-009 an
 * `nft_transfer` source; `--functions` scaffolds typed contract_call tables; any
 * other contract gets a single generic `calls` table. `--trait` scaffolds a
 * trait-scoped source (no contract). All output is deploy-ready (real handlers).
 */
export async function generateSubgraphScaffold(
	input: SubgraphScaffoldInput,
): Promise<string> {
	// Trait mode — no contract; index every conforming contract. Shared with the
	// MCP scaffold_from_trait tool via @secondlayer/scaffold so output matches.
	if (input.trait) {
		return formatCode(
			generateTraitSubgraph({
				trait: input.trait,
				name: input.subgraphName,
				balances: input.balances,
			}),
		);
	}

	const { contractId, abi } = input;
	if (!contractId || !abi) {
		throw new Error("scaffold requires a contractId + abi (or --trait)");
	}
	const name = input.subgraphName ?? contractId.split(".").pop() ?? contractId;

	// Explicit function allowlist → typed contract_call tables.
	if (input.functions && input.functions.length > 0) {
		return formatCode(
			functionsScaffold(name, contractId, abi, input.functions),
		);
	}

	// Standard detection → the right event source for tokens (shared with MCP).
	const token = generateTokenSubgraphFromAbi({ contractId, abi, name });
	if (token) return formatCode(token);

	// Non-token → generic calls table.
	return formatCode(genericCallsScaffold(name, contractId));
}
