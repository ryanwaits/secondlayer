import type { AbiContract } from "@secondlayer/stacks/clarity";
import { classifyContract } from "@secondlayer/stacks/clarity";
import { formatCode } from "../utils/format.ts";
import { clarityTypeToSubgraphColumn } from "./clarity-to-subgraph.ts";

export type ScaffoldTrait = "sip-009" | "sip-010" | "sip-013";

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
}

function toCamelCase(str: string): string {
	return str.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function snake(str: string): string {
	return str.replace(/-/g, "_");
}

function wrap(
	name: string,
	sources: string,
	schema: string,
	handlers: string,
): string {
	return `
import { defineSubgraph } from '@secondlayer/subgraphs';

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

/** ft/nft transfer source + transfers table + working handler. */
function tokenScaffold(
	name: string,
	source: {
		type: "ft_transfer" | "nft_transfer";
		assetIdentifier?: string;
		trait?: ScaffoldTrait;
	},
): string {
	const isFt = source.type === "ft_transfer";
	const scope = source.trait
		? `trait: '${source.trait}'`
		: `assetIdentifier: '${source.assetIdentifier}'`;
	const cols = isFt
		? `        sender: { type: 'principal' },
        recipient: { type: 'principal' },
        amount: { type: 'uint' },
        asset_identifier: { type: 'principal', indexed: true }`
		: `        sender: { type: 'principal' },
        recipient: { type: 'principal' },
        token_id: { type: 'text' },
        asset_identifier: { type: 'principal', indexed: true }`;
	const insert = isFt
		? `{ sender: event.sender, recipient: event.recipient, amount: event.amount, asset_identifier: event.assetIdentifier }`
		: `{ sender: event.sender, recipient: event.recipient, token_id: String(event.tokenId), asset_identifier: event.assetIdentifier }`;
	return wrap(
		name,
		`    transfers: { type: '${source.type}', ${scope} }`,
		`    transfers: {\n      columns: {\n${cols}\n      }\n    }`,
		`    transfers: (event, ctx) => {\n      ctx.insert('transfers', ${insert});\n    }`,
	);
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
	const sources = fns
		.map(
			(f) =>
				`    ${toCamelCase(f.name)}: { type: 'contract_call', contractId: '${contractId}', functionName: '${f.name}' }`,
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
			const inserts = f.args
				// biome-ignore lint/suspicious/noExplicitAny: ABI arg type is dynamic
				.map((arg: { name: string; type: any }, i: number) => {
					const m = clarityTypeToSubgraphColumn(arg.type);
					const ts =
						m.type === "uint" || m.type === "int"
							? "bigint"
							: m.type === "boolean"
								? "boolean"
								: "string";
					return `${snake(arg.name)}: event.args[${i}] as ${ts}`;
				})
				.join(", ");
			return `    ${toCamelCase(f.name)}: (event, ctx) => {\n      ctx.insert('${snake(f.name)}', { ${inserts} });\n    }`;
		})
		.join(",\n\n");
	return wrap(name, sources, schema, handlers);
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
	// Trait mode — no contract; index every conforming contract.
	if (input.trait) {
		const name = input.subgraphName ?? `${input.trait}-transfers`;
		const type = input.trait === "sip-009" ? "nft_transfer" : "ft_transfer";
		return formatCode(tokenScaffold(name, { type, trait: input.trait }));
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

	// Standard detection → the right event source for tokens.
	const standards = classifyContract(abi);
	if (standards.includes("sip-010")) {
		const asset = abi.fungible_tokens?.[0]?.name;
		return formatCode(
			tokenScaffold(name, {
				type: "ft_transfer",
				assetIdentifier: asset ? `${contractId}::${asset}` : contractId,
			}),
		);
	}
	if (standards.includes("sip-009")) {
		const asset = abi.non_fungible_tokens?.[0]?.name;
		return formatCode(
			tokenScaffold(name, {
				type: "nft_transfer",
				assetIdentifier: asset ? `${contractId}::${asset}` : contractId,
			}),
		);
	}

	// Non-token → generic calls table.
	return formatCode(genericCallsScaffold(name, contractId));
}
