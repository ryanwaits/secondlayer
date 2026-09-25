import {
	extractSubgraphDefinition,
	injectSourceAbis,
} from "@secondlayer/bundler";
import { type AbiContract, normalizeAbi } from "@secondlayer/stacks/clarity";
import { StacksApiClient } from "../utils/api.ts";

/**
 * `contract_call` sources that name a `functionName` on ONE concrete contract
 * but declare no `abi`. Those are the ones a deploy can fill in from the
 * contract registry; wildcard, multi-contract and trait sources still need an
 * explicit `abi`.
 */
export function sourcesNeedingAbi(
	sources: unknown,
): Array<{ name: string; contractId: string }> {
	if (!sources || typeof sources !== "object") return [];
	const out: Array<{ name: string; contractId: string }> = [];
	for (const [name, raw] of Object.entries(sources)) {
		const src = raw as Record<string, unknown>;
		if (
			src?.type === "contract_call" &&
			typeof src.functionName === "string" &&
			src.abi === undefined &&
			src.trait === undefined &&
			typeof src.contractId === "string" &&
			!src.contractId.includes("*")
		) {
			out.push({ name, contractId: src.contractId });
		}
	}
	return out;
}

/**
 * Fill in `abi` for every source that needs one, from the deployed contract's
 * interface, and return the source text with the ABIs written in (as if typed
 * by hand) plus the ABIs by source name. Source text that is not statically
 * readable is returned unchanged; the bundler reports why.
 */
export async function withDerivedAbis(
	source: string,
	client: Pick<StacksApiClient, "getContractInfo"> = new StacksApiClient(),
): Promise<{ source: string; abis: Record<string, AbiContract> }> {
	let sources: unknown;
	try {
		sources = extractSubgraphDefinition(source).sources;
	} catch {
		return { source, abis: {} };
	}
	const needed = sourcesNeedingAbi(sources);
	if (needed.length === 0) return { source, abis: {} };

	const byContract = new Map<string, Promise<AbiContract>>();
	const abis: Record<string, AbiContract> = {};
	for (const { name, contractId } of needed) {
		let pending = byContract.get(contractId);
		if (!pending) {
			pending = client.getContractInfo(contractId).then(normalizeAbi);
			byContract.set(contractId, pending);
		}
		try {
			abis[name] = await pending;
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Could not fetch the abi for source "${name}" (${contractId}): ${reason}. Pass abi on the source instead (normalizeAbi() from @secondlayer/stacks/clarity).`,
			);
		}
	}
	return { source: injectSourceAbis(source, abis), abis };
}
