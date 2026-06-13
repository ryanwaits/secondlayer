/**
 * Trait-scoped subgraph scaffold — emits a deploy-ready `defineSubgraph()` that
 * indexes every contract conforming to a SIP standard (no specific contract).
 * SIP-009 → an `nft_transfer` source, every other standard → `ft_transfer`.
 *
 * Single-sourced here so the CLI (`sl subgraphs scaffold --trait`) and the MCP
 * `scaffold_from_trait` tool emit identical output. The `trait` string is
 * validated by callers against `TRAIT_STANDARDS` (from `@secondlayer/stacks`);
 * this generator only maps it to the right event source.
 */

export interface TraitScaffoldInput {
	/** SIP standard id, e.g. "sip-010". */
	trait: string;
	/** Subgraph name (defaults to `<trait>-transfers`). */
	name?: string;
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

export function generateTraitSubgraph(input: TraitScaffoldInput): string {
	const name = input.name ?? `${input.trait}-transfers`;
	const type = input.trait === "sip-009" ? "nft_transfer" : "ft_transfer";
	const isFt = type === "ft_transfer";
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
		? "{ sender: event.sender, recipient: event.recipient, amount: event.amount, asset_identifier: event.assetIdentifier }"
		: "{ sender: event.sender, recipient: event.recipient, token_id: String(event.tokenId), asset_identifier: event.assetIdentifier }";
	return wrap(
		name,
		`    transfers: { type: '${type}', trait: '${input.trait}' }`,
		`    transfers: {\n      columns: {\n${cols}\n      }\n    }`,
		`    transfers: (event, ctx) => {\n      ctx.insert('transfers', ${insert});\n    }`,
	);
}
