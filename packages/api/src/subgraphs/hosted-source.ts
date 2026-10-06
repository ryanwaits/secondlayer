import { getSourceDb } from "@secondlayer/shared/db";
import {
	type SubgraphDefinition,
	isStreamsIndexEligible,
} from "@secondlayer/subgraphs";

/**
 * A stack with no local chain: it reads chain data from a hosted Index/Streams
 * API (`SUBGRAPH_INDEX_API_URL` set) and its own `index_progress` has no row
 * for this network. Derived, not configured: a self-hoster running a local
 * indexer has the row and keeps the Postgres tap.
 */
export async function hasNoLocalChain(
	opts: {
		env?: NodeJS.ProcessEnv;
		hasProgressRow?: (network: string) => Promise<boolean>;
	} = {},
): Promise<boolean> {
	const env = opts.env ?? process.env;
	if (!env.SUBGRAPH_INDEX_API_URL) return false;
	const network = env.NETWORK ?? "mainnet";
	const hasRow = opts.hasProgressRow ?? hasLocalProgressRow;
	return !(await hasRow(network));
}

async function hasLocalProgressRow(network: string): Promise<boolean> {
	const select = (db: ReturnType<typeof getSourceDb>) =>
		db
			.selectFrom("index_progress")
			.select("network")
			.where("network", "=", network)
			.executeTakeFirst();
	const row = await select(getSourceDb()).catch(() => undefined);
	return row !== undefined;
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
