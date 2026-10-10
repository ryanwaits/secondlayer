/** Quickstart steps for the intro QuickstartPanel. `kw` is the highlighted
 *  leading token of the command; `rest` is the remainder. `link` is an
 *  optional pointer shown after the description. No sample output by design. */
export interface QuickstartStep {
	n: string;
	tab: string;
	title: string;
	desc: string;
	kw: string;
	rest: string;
	link?: { label: string; href: string };
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
		tab: "Variables",
		title: "Set two variables",
		desc: "Create an sk-sl_ key at /account/keys. The CLI and SDK send it on api.secondlayer.tools, and every example in these docs reads both variables.",
		kw: "export",
		rest: " SECONDLAYER_API_URL=https://api.secondlayer.tools SECONDLAYER_API_KEY=sk-sl_...",
		link: { label: "Running your own box instead?", href: "/docs/self-host" },
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
		desc: "It backfills from startBlock (set one: the event and transaction rows it reads bill) and keeps the table live as new blocks arrive.",
		kw: "secondlayer",
		rest: " subgraphs deploy subgraphs/my-balances.ts",
	},
	{
		n: "05",
		tab: "Query",
		title: "Read it back",
		desc: 'Rows serve the moment the first block lands; reads of your own tables are free. Same read from the SDK: sl.subgraphs.rows("my-balances", "balances").',
		kw: "curl",
		rest: ' -H "Authorization: Bearer $SECONDLAYER_API_KEY" "$SECONDLAYER_API_URL/v1/subgraphs/my-balances/balances"',
	},
];
