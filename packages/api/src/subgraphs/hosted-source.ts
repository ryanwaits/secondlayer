import { getSourceDb } from "@secondlayer/shared/db";
import { hasNoLocalChain as stackHasNoLocalChain } from "@secondlayer/shared/db/queries/instance";
import {
	type SubgraphDefinition,
	isStreamsIndexEligible,
} from "@secondlayer/subgraphs";

/** A hosted tenant stack: no local chain, reads the hosted Index/Streams API.
 *  The rule lives in shared so the webhook evaluator applies the same one. */
export function hasNoLocalChain(
	opts: Parameters<typeof stackHasNoLocalChain>[1] = {},
): Promise<boolean> {
	return stackHasNoLocalChain(getSourceDb(), opts);
}

/**
 * Name of the first source a hosted stack can't feed (one that
 * `resolveBlockSource` would send to the local Postgres tap), or null when
 * every source can run off the hosted Index/Streams plane.
 */
export function findUnhostableSource(
	def: Pick<SubgraphDefinition, "sources">,
): string | null {
	const sources = def.sources as unknown;
	if (Array.isArray(sources)) {
		return isStreamsIndexEligible(def as SubgraphDefinition) ? null : "sources";
	}
	for (const [name, filter] of Object.entries(
		(sources ?? {}) as Record<string, unknown>,
	)) {
		const single = { sources: { [name]: filter } } as SubgraphDefinition;
		if (!isStreamsIndexEligible(single)) return name;
	}
	return null;
}
