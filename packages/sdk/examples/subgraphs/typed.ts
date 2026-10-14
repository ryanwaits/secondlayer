import { SecondLayer } from "@secondlayer/sdk";
import { defineSubgraph } from "@secondlayer/subgraphs";

const sbtcFlows = defineSubgraph({
	name: "sbtc-flows",
	startBlock: 8000000,
	sources: {
		transfers: {
			type: "ft_transfer",
			assetIdentifier:
				"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
		},
	},
	schema: {
		transfers: {
			columns: {
				amount: { type: "uint" },
				sender: { type: "principal" },
				recipient: { type: "principal" },
			},
		},
	},
	handlers: {
		transfers: (event, ctx) => {
			ctx.insert("transfers", {
				amount: event.amount,
				sender: event.sender,
				recipient: event.recipient,
			});
		},
	},
});

const sl = new SecondLayer({
	apiKey: process.env.SECONDLAYER_API_KEY,
});

// !callout[/typed/] Table names and column types come from the schema literal above.
const subgraph = sl.subgraphs.typed(sbtcFlows);

const page = await subgraph.transfers.findMany({
	where: { amount: { gte: 1_000_000n } },
	orderBy: { amount: "desc" },
	limit: 10,
	fields: ["sender", "recipient", "amount"],
});

for (const row of page.rows) {
	// !callout[/row.amount/] uint columns come back as bigint.
	console.log(row.sender, row.recipient, row.amount);
}

// !callout[/nextCursor/] Set on every page that returned rows. Pass it back as `cursor` to continue.
console.log(page.nextCursor);
