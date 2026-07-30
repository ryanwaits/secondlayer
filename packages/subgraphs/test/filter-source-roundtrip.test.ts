import { describe, expect, test } from "bun:test";
import { fromSubgraphSource } from "@secondlayer/stacks/filters";
import bnsNames from "../../../subgraphs/bns-names.ts";
import contractDeployments from "../../../subgraphs/contract-deployments.ts";
import poxStacking from "../../../subgraphs/pox-stacking.ts";
import sbtcFlows from "../../../subgraphs/sbtc-flows.ts";
import type { SubgraphFilter } from "../src/types.ts";

/**
 * CI gate: every PRODUCTION subgraph source must survive
 * `toSubgraphSource(fromSubgraphSource(f))` unchanged. This pins two things:
 * the canonical vocabulary can express every filter actually deployed, and
 * the projection is lossless — a migration to `on.*` can never silently
 * change what a live subgraph indexes.
 */

const PRODUCTION_DEFS = [
	{ name: "bns-names", def: bnsNames },
	{ name: "contract-deployments", def: contractDeployments },
	{ name: "pox-stacking", def: poxStacking },
	{ name: "sbtc-flows", def: sbtcFlows },
];

describe("production subgraph sources round-trip the canonical vocabulary (CI gate)", () => {
	for (const { name, def } of PRODUCTION_DEFS) {
		test(`${name}: toSubgraphSource(fromSubgraphSource(f)) deep-equals f`, () => {
			const sources = def.sources as Record<string, SubgraphFilter>;
			expect(Object.keys(sources).length).toBeGreaterThan(0);
			for (const [sourceName, filter] of Object.entries(sources)) {
				const roundTripped = fromSubgraphSource(
					// The canonical spec union is structurally a superset of
					// SubgraphFilter (same members, same fields).
					filter as Parameters<typeof fromSubgraphSource>[0],
				).toSubgraphSource();
				expect(roundTripped, `${name}.${sourceName}`).toEqual(filter);
			}
		});
	}
});
