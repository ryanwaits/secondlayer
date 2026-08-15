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
		tab: "Start",
		title: "Start the one-box",
		desc: "init writes config; compose brings up postgres + secondlayer beside your Stacks node. Your API is live at http://127.0.0.1:3800 — loopback needs no token.",
		kw: "secondlayer",
		rest: " init && docker compose up -d",
	},
	{
		n: "03",
		tab: "Bootstrap",
		title: "Bootstrap verified history",
		desc: "Restores signed history from the archive into an empty database instead of syncing from genesis. Verifying is free; full-history bootstrap draws metered archive credits.",
		kw: "secondlayer",
		rest: " bootstrap",
	},
	{
		n: "04",
		tab: "Create",
		title: "Create from your contract",
		desc: "Infers schema, triggers, and handler from the contract's observed print events, into one file ready to edit or deploy as-is.",
		kw: "secondlayer",
		rest: " subgraphs create my-balances --from-contract SP....my-contract",
	},
	{
		n: "05",
		tab: "Deploy",
		title: "Deploy it",
		desc: "Indexes forward from the chain tip and keeps the table live as new blocks arrive; with bootstrapped history it backfills from genesis.",
		kw: "secondlayer",
		rest: " subgraphs deploy subgraphs/my-balances.ts",
	},
	{
		n: "06",
		tab: "Query",
		title: "Read it back",
		desc: 'Rows serve from your instance the moment the first block lands. Same read from the SDK — sl.subgraphs.rows("my-balances", "balances").',
		kw: "curl",
		rest: " http://127.0.0.1:3800/v1/subgraphs/my-balances/balances",
	},
];
