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
		tab: "Setup",
		title: "Set up the one-box",
		desc: "One guided command: secrets, docker-compose + .env written for you, the stack brought up, and verified history restored from the archive instead of syncing from genesis. Your API is live at http://127.0.0.1:3800 — loopback reads need no token; setup prints the INSTANCE_TOKEN export for writes.",
		kw: "secondlayer",
		rest: " setup",
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
		desc: "Indexes forward from the chain tip and keeps the table live as new blocks arrive; with bootstrapped history it backfills from genesis.",
		kw: "secondlayer",
		rest: " subgraphs deploy subgraphs/my-balances.ts",
	},
	{
		n: "05",
		tab: "Query",
		title: "Read it back",
		desc: 'Rows serve from your instance the moment the first block lands. Same read from the SDK — sl.subgraphs.rows("my-balances", "balances").',
		kw: "curl",
		rest: " http://127.0.0.1:3800/v1/subgraphs/my-balances/balances",
	},
];
