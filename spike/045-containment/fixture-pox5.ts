import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Benign fixture for the containment spike: stack B's "keeps advancing"
 * measurement and the runsc-vs-runc per-block timing. `run.sh` replaces
 * __START_BLOCK__ with (hosted tip - N) before bundling so catch-up walks a
 * known number of historic blocks, then follows the tip.
 *
 * pox-5 stakes are sparse; stx_transfer is dense, so most blocks run a
 * handler and write rows instead of timing an empty loop.
 */
export default defineSubgraph({
	name: "spike-pox5-fixture",
	startBlock: __START_BLOCK__,
	sources: {
		stake: {
			type: "print_event",
			contractId: "SP000000000000000000002Q6VF78.pox-5",
			topic: "stake",
			prints: { stake: { staker: "principal", amountUstx: "uint" } },
		},
		transfer: { type: "stx_transfer" },
	},
	schema: {
		stakes: {
			columns: {
				staker: { type: "principal" },
				amount_ustx: { type: "uint" },
			},
		},
		transfers: {
			columns: {
				sender: { type: "principal" },
				recipient: { type: "principal" },
				amount: { type: "uint" },
			},
		},
	},
	handlers: {
		stake: async (event, ctx) => {
			ctx.insert("stakes", {
				staker: event.data.staker,
				amount_ustx: event.data.amountUstx,
			});
		},
		transfer: async (event, ctx) => {
			ctx.insert("transfers", {
				sender: event.sender,
				recipient: event.recipient,
				amount: event.amount,
			});
		},
	},
});
