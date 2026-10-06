/** Shared Quickstart steps — consumed by the intro QuickstartPanel and the
 *  /docs/quickstart guided session. `kw` is the highlighted leading token of
 *  the command; `rest` is the remainder. No sample output by design. */
export interface QuickstartStep {
	n: string;
	tab: string;
	title: string;
	desc: string;
	kw: string;
	rest: string;
}

export const QUICKSTART_STEPS: QuickstartStep[] = [
	{
		n: "01",
		tab: "Install",
		title: "Install the CLI",
		desc: "One global binary; works with bun, npm, or pnpm.",
		kw: "bun",
		rest: " add -g @secondlayer/cli",
	},
	{
		n: "02",
		tab: "Key",
		title: "Point it at the hosted API",
		desc: "Create an sk-sl_ key at /account/keys; the CLI and SDK send it on api.secondlayer.tools. Prefer your own box? Run `secondlayer setup` instead (guided: secrets, docker-compose, verified history from the archive) and use http://127.0.0.1:3800 below, with the INSTANCE_TOKEN it prints.",
		kw: "export",
		rest: " SECONDLAYER_API_URL=https://api.secondlayer.tools SECONDLAYER_API_KEY=sk-sl_...",
	},
	{
		n: "03",
		tab: "Create",
		title: "Create from your contract",
		desc: "Infers schema, triggers, and handler from the contract's observed print events, into one file ready to edit or deploy as-is.",
		kw: "secondlayer",
		rest: " subgraphs create my-balances --from-contract SP....my-contract",
	},
	{
		n: "04",
		tab: "Deploy",
		title: "Deploy it",
		desc: "Hosted, it backfills from startBlock (set one: event and transaction rows it reads bill) and keeps the table live as new blocks arrive. On your own box with bootstrapped history it backfills from genesis.",
		kw: "secondlayer",
		rest: " subgraphs deploy subgraphs/my-balances.ts",
	},
	{
		n: "05",
		tab: "Query",
		title: "Read it back",
		desc: 'Rows serve the moment the first block lands; reads of your own tables are free. Send the key as a bearer token (self-host: http://127.0.0.1:3800, no token on loopback). Same read from the SDK — sl.subgraphs.rows("my-balances", "balances").',
		kw: "curl",
		rest: ' -H "Authorization: Bearer $SECONDLAYER_API_KEY" https://api.secondlayer.tools/v1/subgraphs/my-balances/balances',
	},
];
