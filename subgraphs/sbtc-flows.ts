// ───────────────────────────────────────────────────────────────────
// Canonical source for the HOSTED PUBLIC `sbtc-flows` subgraph.
//
// Recovered into git 2026-06-20 from the deployed source-capture
// (GET /api/subgraphs/sbtc-flows/source) — it had been deployed from a
// local file never committed. This file is now the source of truth; edit
// here and redeploy, never deploy an out-of-tree copy.
//
// KNOWN DRIFT (do not silently "fix" — reconcile via redeploy in a later
// sprint): the deployment's DB `start_block` is 5_143_314 (a `--start-block`
// override at deploy), while the declared `startBlock` below is 860_000.
// The override lives only in the deploy invocation. The committed code is
// semantically identical to the deployed source (definition/schema/handler
// unchanged); only whitespace was normalized to repo lint style.
//
// Schema parity verified against live meta (GET /v1/subgraphs/sbtc-flows):
// table `flows` columns == topic, request_id, amount, sender, bitcoin_txid,
// burn_height.
// ───────────────────────────────────────────────────────────────────

import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Track sBTC protocol flows: deposits, withdrawals, signer rotations,
 * governance updates — your own indexed view of the sbtc-registry contract.
 *
 * Source contract: sbtc-registry (mainnet).
 *
 * Query examples once deployed:
 *   GET /v1/subgraphs/sbtc-flows/flows?topic=completed-deposit
 *   GET /v1/subgraphs/sbtc-flows/flows?topic=withdrawal-create
 */
export default defineSubgraph({
	name: "sbtc-flows",
	version: "1.0.0",
	description: "sBTC deposits, withdrawals, signer rotations, governance",

	// Skip pre-sBTC history. Raise this (e.g., to a recent block near tip) for
	// a smaller backfill, or lower it if you need every sBTC event from genesis.
	startBlock: 860000,

	sources: {
		registry: {
			type: "print_event",
			contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
		},
	},

	schema: {
		flows: {
			columns: {
				topic: { type: "text", indexed: true, search: true },
				request_id: { type: "uint", nullable: true, indexed: true },
				amount: { type: "text", nullable: true },
				sender: { type: "principal", nullable: true, indexed: true },
				bitcoin_txid: { type: "text", nullable: true, search: true },
				burn_height: { type: "uint", nullable: true },
			},
		},
	},

	handlers: {
		registry: (event, ctx) => {
			if (!event.topic) return;
			// event.data is untyped across topics — cast to the fields you read, or
			// declare `prints` per topic on the source for fully typed event.data.
			const data = event.data as {
				requestId?: bigint;
				amount?: bigint | string;
				sender?: string;
				bitcoinTxid?: string;
				burnHeight?: bigint;
			};
			ctx.insert("flows", {
				topic: event.topic,
				request_id: data.requestId ?? null,
				amount: data.amount != null ? String(data.amount) : null,
				sender: data.sender ?? null,
				bitcoin_txid: data.bitcoinTxid ?? null,
				burn_height: data.burnHeight ?? null,
			});
		},
	},
});
