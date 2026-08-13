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
 * OSS: name is unique and always readable — no account, tenant, or
 * visibility branch. Platform: owned first, then public-by-name.
 */
export function resolveReadableSubgraph(
	cache: SubgraphRegistryCache,
	name: string,
	accountId?: string,
): Subgraph | undefined {
	if (!isPlatformMode()) return cache.get(name);
	if (accountId) {
		const own = cache.get(name, accountId);
		if (own) return own;
	}
	return cache.getPublicByName(name);
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
