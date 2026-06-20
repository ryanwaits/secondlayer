// ───────────────────────────────────────────────────────────────────
// Canonical source for the HOSTED PUBLIC `sbtc-flows` subgraph.
//
// Recovered into git 2026-06-20 from the deployed source-capture
// (GET /api/subgraphs/sbtc-flows/source) — it had been deployed from a
// local file never committed. This file is now the source of truth; edit
// here and redeploy, never deploy an out-of-tree copy.
//
// startBlock is the sbtc-registry mainnet deploy height (328_228, our index
// system == Hiro). The original deployment ran start_block 5_143_314 and never
// backfilled (created 2026-06-11, only live-tailed from ~block 6.8M), so it
// held ~887 of 5_321 deposits. Reindexing from 328_228 backfills full history.
//
// v1.2.0 (not yet deployed): typed schema — `events` is the raw all-topics
// registry log (renamed from the vague `flows`); `deposits` and `withdrawals`
// are typed per-topic projections so the sBTC explorer reads them directly
// instead of bespoke /v1/index/sbtc/* endpoints
// (see docs/internal/charter/index-vs-subgraphs.md).
// ───────────────────────────────────────────────────────────────────

import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Track sBTC protocol activity: deposits, withdrawals, signer rotations,
 * governance updates — your own indexed view of the sbtc-registry contract.
 *
 * Source contract: sbtc-registry (mainnet).
 *
 * Query examples once deployed:
 *   GET /v1/subgraphs/sbtc-flows/deposits
 *   GET /v1/subgraphs/sbtc-flows/withdrawals?status=ACCEPTED
 *   GET /v1/subgraphs/sbtc-flows/events?topic=key-rotation
 */
export default defineSubgraph({
	name: "sbtc-flows",
	version: "1.2.0",
	description: "sBTC deposits, withdrawals, signer rotations, governance",

	// sbtc-registry mainnet deploy height — the earliest block that can carry an
	// sBTC event. Reindex from here for full-history backfill.
	startBlock: 328228,

	sources: {
		registry: {
			type: "print_event",
			contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
		},
	},

	schema: {
		// Raw all-topics registry log (renamed from `flows`): one row per print
		// event of any topic (deposits, withdrawals, key-rotation, governance).
		// The firehose + the home of signer/governance events not otherwise typed.
		events: {
			columns: {
				topic: { type: "text", indexed: true, search: true },
				request_id: { type: "uint", nullable: true, indexed: true },
				amount: { type: "text", nullable: true },
				sender: { type: "principal", nullable: true, indexed: true },
				bitcoin_txid: { type: "text", nullable: true, search: true },
				burn_height: { type: "uint", nullable: true },
			},
		},

		// Typed peg-in: one row per completed-deposit (terminal event). `block_time`
		// is unix seconds. `bitcoin_txid` is the funding BTC tx.
		deposits: {
			columns: {
				amount: { type: "text", nullable: true },
				bitcoin_txid: {
					type: "text",
					nullable: true,
					indexed: true,
					search: true,
				},
				output_index: { type: "uint", nullable: true },
				block_time: { type: "uint", nullable: true },
			},
		},

		// Typed peg-out: one row per request_id, status derived across the
		// lifecycle (withdrawal-create → accept/reject). Maintained by keyed
		// upsert/update; reorg-safe via the schema `_journal` (an orphaned accept
		// reverts the row to REQUESTED). `requested_at`/`resolved_at` are unix
		// seconds (block time).
		withdrawals: {
			columns: {
				request_id: { type: "uint", indexed: true },
				status: { type: "text", indexed: true },
				amount: { type: "text", nullable: true },
				sender: { type: "principal", nullable: true, indexed: true },
				sweep_txid: { type: "text", nullable: true, search: true },
				requested_at: { type: "uint", nullable: true },
				resolved_at: { type: "uint", nullable: true },
			},
			uniqueKeys: [["request_id"]],
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
				sweepTxid?: string;
				bitcoinTxid?: string;
				outputIndex?: bigint | number;
				burnHeight?: bigint;
			};

			// Raw all-topics log.
			ctx.insert("events", {
				topic: event.topic,
				request_id: data.requestId ?? null,
				amount: data.amount != null ? String(data.amount) : null,
				sender: data.sender ?? null,
				bitcoin_txid: data.bitcoinTxid ?? null,
				burn_height: data.burnHeight ?? null,
			});

			// Typed peg-in projection.
			if (event.topic === "completed-deposit") {
				ctx.insert("deposits", {
					amount: data.amount != null ? String(data.amount) : null,
					bitcoin_txid: data.bitcoinTxid ?? null,
					output_index: data.outputIndex ?? null,
					block_time: ctx.block.timestamp,
				});
				return;
			}

			// Typed peg-out lifecycle rollup. create seeds the row; accept/reject
			// update the same request_id with the resolved status.
			const requestId = data.requestId;
			if (requestId == null) return;
			if (event.topic === "withdrawal-create") {
				ctx.upsert(
					"withdrawals",
					{ request_id: requestId },
					{
						status: "REQUESTED",
						amount: data.amount != null ? String(data.amount) : null,
						sender: data.sender ?? null,
						sweep_txid: null,
						requested_at: ctx.block.timestamp,
						resolved_at: null,
					},
				);
			} else if (event.topic === "withdrawal-accept") {
				ctx.update(
					"withdrawals",
					{ request_id: requestId },
					{
						status: "ACCEPTED",
						sweep_txid: data.sweepTxid ?? null,
						resolved_at: ctx.block.timestamp,
					},
				);
			} else if (event.topic === "withdrawal-reject") {
				ctx.update(
					"withdrawals",
					{ request_id: requestId },
					{ status: "REJECTED", resolved_at: ctx.block.timestamp },
				);
			}
		},
	},
});
