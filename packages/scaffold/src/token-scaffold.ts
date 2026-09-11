/**
 * SIP-010/009 token-transfer scaffold — single-sourced for CLI `subgraphs scaffold`
 * and MCP `subgraphs_scaffold` when a contract has no observed prints.
 */

import type { AbiContract } from "@secondlayer/stacks/clarity";
import { classifyContract } from "@secondlayer/stacks/clarity";

export interface TokenScaffoldInput {
	name: string;
	type: "ft_transfer" | "nft_transfer";
	assetIdentifier: string;
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
export function generateTokenSubgraph(input: TokenScaffoldInput): string {
	const isFt = input.type === "ft_transfer";
	const scope = `assetIdentifier: '${input.assetIdentifier}'`;
	const cols = isFt
		? `        sender: { type: 'principal' },
        recipient: { type: 'principal' },
        amount: { type: 'uint' },
        asset_identifier: { type: 'text', indexed: true }`
		: `        sender: { type: 'principal' },
        recipient: { type: 'principal' },
        token_id: { type: 'text' },
        asset_identifier: { type: 'text', indexed: true }`;
	const insert = isFt
		? "{ sender: event.sender, recipient: event.recipient, amount: event.amount, asset_identifier: event.assetIdentifier }"
		: "{ sender: event.sender, recipient: event.recipient, token_id: String(event.tokenId), asset_identifier: event.assetIdentifier }";
	return wrap(
		input.name,
		`    transfers: { type: '${input.type}', ${scope} }`,
		`    transfers: {\n      columns: {\n${cols}\n      }\n    }`,
		`    transfers: (event, ctx) => {\n      ctx.insert('transfers', ${insert});\n    }`,
	);
}

/**
 * Classify ABI → SIP-010/009 token scaffold, or null when the contract is not a
 * fungible/non-fungible token standard.
 */
export function generateTokenSubgraphFromAbi(input: {
	contractId: string;
	abi: AbiContract;
	name?: string;
}): string | null {
	const name =
		input.name ?? input.contractId.split(".").pop() ?? input.contractId;
	const standards = classifyContract(input.abi);
	if (standards.includes("sip-010")) {
		const asset = input.abi.fungible_tokens?.[0]?.name;
		return generateTokenSubgraph({
			name,
			type: "ft_transfer",
			assetIdentifier: asset
				? `${input.contractId}::${asset}`
				: input.contractId,
		});
	}
	if (standards.includes("sip-009")) {
		const asset = input.abi.non_fungible_tokens?.[0]?.name;
		return generateTokenSubgraph({
			name,
			type: "nft_transfer",
			assetIdentifier: asset
				? `${input.contractId}::${asset}`
				: input.contractId,
		});
	}
	return null;
}
