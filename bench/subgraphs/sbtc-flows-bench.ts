// ───────────────────────────────────────────────────────────────────
// Bench subgraph for the 2026-05 shared-rip backfill verification.
//
// Shape: filtered customer-grade subgraph — single contract, print events,
// startBlock at sbtc-registry's first emit (verified via prod query
// 2026-05-15: block 328312, 8832 events total through chain tip).
//
// This mirrors what a real customer would write (and what the Foundation
// Datasets `sbtc-flows` template generates). It's the right shape to
// compare against the historical 20-30m shared baseline.
//
// Deploy:    sl subgraphs deploy bench/subgraphs/sbtc-flows-bench.ts
// Status:    sl subgraphs status sbtc-flows-bench
// Stats:     SELECT SUM(blocks_processed), SUM(total_time_ms)
//              FROM subgraph_processing_stats
//              WHERE subgraph_name = 'sbtc-flows-bench' AND is_catchup = true;
// Tear down: sl subgraphs delete sbtc-flows-bench
// ───────────────────────────────────────────────────────────────────

import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
	name: "sbtc-flows-bench",
	version: "1.0.0",
	description:
		"Bench — sBTC registry print events from contract activation. Mirrors customer-shape subgraph for backfill speed measurement.",

	startBlock: 328_312,

	sources: {
		registry: {
			type: "print_event",
			contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
		},
	},

	schema: {
		flows: {
			columns: {
				topic: { type: "text", indexed: true },
			},
		},
	},

	handlers: {
		registry: (event, ctx) => {
			// `event.topic` is the decoded print-event topic (from the Clarity tuple),
			// not `event.payload.topic` — there is no `payload` on the event.
			const topic = (event as { topic?: unknown }).topic;
			ctx.insert("flows", {
				topic: typeof topic === "string" ? topic : "unknown",
			});
		},
	},
});
