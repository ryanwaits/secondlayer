import type { Subgraph } from "@secondlayer/shared/db";
import {
	pgSchemaName,
	pgSchemaNameFor,
} from "@secondlayer/shared/db/queries/subgraphs";
import { isPlatformMode } from "@secondlayer/shared/mode";
import type { SubgraphRegistryCache } from "./cache.ts";

/**
 * Resolve a subgraph for a read.
 *
 * Self-host only: the name is unique and always readable — no account,
 * tenant, or visibility branch. Hosted does not serve subgraph reads.
 */
export function resolveReadableSubgraph(
	cache: SubgraphRegistryCache,
	name: string,
): Subgraph | undefined {
	return cache.get(name);
}

/** Platform keeps the request account; OSS has no accounts. */
export function deployAccountId(
	requestAccountId: string | undefined,
): string | undefined {
	return isPlatformMode() ? requestAccountId : undefined;
}

/** Prefer a stored schema name so leftover OSS rows keep their plane. */
export function deploySchemaName(
	name: string,
	accountId: string | undefined,
	existingSchemaName?: string | null,
): string {
	if (existingSchemaName) return existingSchemaName;
	if (!isPlatformMode()) return pgSchemaName(name);
	return pgSchemaNameFor(accountId ?? "", name);
}
