// ───────────────────────────────────────────────────────────────────
// Canonical source for the HOSTED PUBLIC `pox-stacking` subgraph.
//
// Recovered into git 2026-06-20 from the deployed source-capture
// (GET /api/subgraphs/pox-stacking/source) — deployed from an uncommitted
// local file. This file is now the source of truth; edit here and redeploy.
//
// KNOWN DRIFT (reconcile via redeploy in a later sprint): the deployment's
// DB `start_block` is 5_143_314 (a `--start-block` override at deploy); the
// source below declares none (defaults to genesis). The committed code is
// semantically identical to the deployed source; whitespace normalized to
// repo lint style.
//
// Schema parity verified against live meta (GET /v1/subgraphs/pox-stacking):
// table `calls`.
// ───────────────────────────────────────────────────────────────────

import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Track Stacking lifecycle calls on PoX-4 — solo stacking, delegation,
 * extension, increase, aggregation, signer-key authorizations.
 *
 * Note: PoX-4 emits zero print events; this subgraph captures contract
 * calls. Decoding function args + raw_result is left to your handler.
 *
 * Query examples once deployed:
 *   GET /v1/subgraphs/pox-stacking/calls?function_name=stack-stx
 *   GET /v1/subgraphs/pox-stacking/calls?caller=SP1...
 */
export default defineSubgraph({
	name: "pox-stacking",
	version: "1.0.0",
	description: "PoX-4 stacking lifecycle calls",

	sources: {
		pox: {
			type: "contract_call",
			contractId: "SP000000000000000000002Q6VF78.pox-4",
		},
	},

	schema: {
		calls: {
			columns: {
				function_name: { type: "text", indexed: true, search: true },
				caller: { type: "principal", indexed: true, search: true },
				result_ok: { type: "boolean" },
			},
		},
	},

	handlers: {
		pox: (event, ctx) => {
			// contract_call events are typed: functionName, resultHex, args, sender.
			// (Add an `abi` to the source to also get typed `event.input`.)
			const resultHex = event.resultHex ?? "";
			ctx.insert("calls", {
				function_name: event.functionName || ctx.tx.functionName || "",
				caller: ctx.tx.sender,
				result_ok: resultHex.startsWith("0x07"), // 0x07 = response-ok type tag
			});
		},
	},
});
