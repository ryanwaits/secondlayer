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

export type StateSource = {
	name: string;
	contractId: string;
	kind: "map" | "var";
	stateName: string;
};

/**
 * State-write sources (`map_set`/`map_insert`/`map_delete`, `var_set`) that
 * name one map or variable on ONE concrete contract. A deploy can check that
 * name against the contract's interface. Sources without a name, or scoped by
 * wildcard or trait, are not checked.
 */
export function sourcesNamingState(sources: unknown): StateSource[] {
	if (!sources || typeof sources !== "object") return [];
	const out: StateSource[] = [];
	for (const [name, raw] of Object.entries(sources)) {
		const src = raw as Record<string, unknown>;
		if (
			typeof src?.contractId !== "string" ||
			src.contractId.includes("*") ||
			src.trait !== undefined
		) {
			continue;
		}
		if (
			(src.type === "map_set" ||
				src.type === "map_insert" ||
				src.type === "map_delete") &&
			typeof src.map === "string"
		) {
			out.push({
				name,
				contractId: src.contractId,
				kind: "map",
				stateName: src.map,
			});
		} else if (src.type === "var_set" && typeof src.varName === "string") {
			out.push({
				name,
				contractId: src.contractId,
				kind: "var",
				stateName: src.varName,
			});
		}
	}
	return out;
}

/**
 * Fill in `abi` for every source that needs one, from the deployed contract's
 * interface, and return the source text with the ABIs written in (as if typed
 * by hand) plus the ABIs by source name. Also fails when a state source names
 * a map or variable its contract does not define. Source text that is not statically
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
	const stateSources = sourcesNamingState(sources);
	if (needed.length === 0 && stateSources.length === 0) {
		return { source, abis: {} };
	}

	const byContract = new Map<string, Promise<AbiContract>>();
	const abis: Record<string, AbiContract> = {};
	const interfaceOf = (contractId: string) => {
		let pending = byContract.get(contractId);
		if (!pending) {
			pending = client.getContractInfo(contractId).then(normalizeAbi);
			byContract.set(contractId, pending);
		}
		return pending;
	};
	for (const { name, contractId } of needed) {
		const pending = interfaceOf(contractId);
		try {
			abis[name] = await pending;
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Could not fetch the abi for source "${name}" (${contractId}): ${reason}. Pass abi on the source instead (normalizeAbi() from @secondlayer/stacks/clarity).`,
			);
		}
	}
	for (const { name, contractId, kind, stateName } of stateSources) {
		let contract: AbiContract;
		try {
			contract = await interfaceOf(contractId);
		} catch {
			// The source is valid without an interface; nothing to check against.
			continue;
		}
		const defined = (
			(kind === "map" ? contract.maps : contract.variables) ?? []
		).map((entry) => entry.name);
		if (!defined.includes(stateName)) {
			const noun = kind === "map" ? "map" : "variable";
			throw new Error(
				`Source "${name}" reads ${noun} "${stateName}", which ${contractId} does not define. Its ${noun}s: ${defined.join(", ") || "none"}.`,
			);
		}
	}
	return { source: injectSourceAbis(source, abis), abis };
}
