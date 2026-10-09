/**
 * The pure block core: match one block's data against a subgraph's sources
 * and run its handlers against a context. No database, no flush, no cursor.
 *
 * `processBlock` (Postgres) and replay (memory) both go through here, so the
 * rows a served subgraph holds and the rows a client recomputes come from the
 * same matcher and the same dispatch order.
 */
import type { SubgraphDefinition } from "../types.ts";
import type { SubgraphContext } from "./context.ts";
import { type RunResult, buildEventPayload, runHandlers } from "./runner.ts";
import {
	type EventRecord,
	type FactoryContracts,
	type MatchedTx,
	type TraitContracts,
	type TxRecord,
	matchSources,
	readPath,
} from "./source-matcher.ts";

/** One block's handler inputs. `BlockData` (DB tap / Index API) is one. */
export interface BlockInputs {
	txs: TxRecord[];
	/** Classic events. */
	events: EventRecord[];
	/** Write events on the vm clock (`var_set`, `map_*`, nested calls). */
	vmEvents?: EventRecord[];
}

/** Contract sets a source can be scoped to, resolved by the caller as of the
 *  block being applied. */
export interface BlockScopes {
	trait?: TraitContracts;
	factory?: FactoryContracts;
}

/** Match a block's transactions and events against the subgraph's sources. */
export function matchBlock(
	def: Pick<SubgraphDefinition, "sources">,
	data: BlockInputs,
	scopes: BlockScopes = {},
): MatchedTx[] {
	return matchSources(
		def.sources,
		data.txs,
		data.events,
		scopes.trait ?? new Map(),
		scopes.factory ?? new Map(),
		data.vmEvents ?? [],
	);
}

/** Match the block, then run the matched handlers against `ctx`. The caller
 *  owns the context: flush it (Postgres) or commit it (memory). */
export async function applyBlock(
	def: SubgraphDefinition,
	data: BlockInputs,
	ctx: SubgraphContext,
	scopes: BlockScopes = {},
): Promise<{ matched: number } & RunResult> {
	const matched = matchBlock(def, data, scopes);
	if (matched.length === 0) {
		return { matched: 0, processed: 0, errors: 0, delivered: 0 };
	}
	return { matched: matched.length, ...(await runHandlers(def, matched, ctx)) };
}

/**
 * The addresses this block's own events reveal to each factory, computed
 * before matching so a contract discovered in block N receives its own
 * block-N events.
 *
 * `known` is keyed by the discovering source (`factory.from`) and holds every
 * address revealed below this block; it is extended in place, so after the
 * call it is the factory scope for this block. Returns only the new reveals.
 */
export function discoverFactoryAddresses(
	def: Pick<SubgraphDefinition, "sources">,
	data: BlockInputs,
	known: Map<string, Set<string>>,
): Array<{ sourceName: string; address: string }> {
	// Keyed by the DISCOVERING source, not the consuming one: several sources
	// can share one factory, and the extraction runs once per discoverer.
	const factories = new Map<string, { from: string; field: string }>();
	for (const source of Object.values(def.sources)) {
		const factory = (source as { factory?: { from: string; field: string } })
			.factory;
		if (factory) factories.set(factory.from, factory);
	}
	const discovered: Array<{ sourceName: string; address: string }> = [];
	for (const [discoveringSource, factory] of factories) {
		let set = known.get(discoveringSource);
		if (!set) {
			set = new Set();
			known.set(discoveringSource, set);
		}
		const discovering = def.sources[factory.from];
		if (!discovering) continue;
		const matches = matchBlock(
			{ sources: { [factory.from]: discovering } },
			data,
		);
		for (const match of matches) {
			for (const event of match.events ?? []) {
				const payload = buildEventPayload(discovering, match.tx, event);
				const value = readPath(payload, factory.field);
				if (typeof value === "string" && value.length > 0 && !set.has(value)) {
					set.add(value);
					discovered.push({ sourceName: discoveringSource, address: value });
				}
			}
		}
	}
	return discovered;
}
