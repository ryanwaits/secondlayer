/** Quickstart steps for the intro QuickstartPanel: one command each, with a
 *  sentence on what it does. No sample output by design. */
export interface QuickstartStep {
	n: string;
	tab: string;
	desc: string;
	cmd: string;
}

export const QUICKSTART_STEPS: QuickstartStep[] = [
	{
		n: "01",
		tab: "Install",
		desc: "One global binary; works with bun, npm, or pnpm.",
		cmd: "bun add -g @secondlayer/cli",
	},
	{
		n: "02",
		tab: "Variables",
		desc: "Create an sk-sl_ key at /account/keys. The CLI and SDK send it on api.secondlayer.tools, and every example in these docs reads both variables.",
		cmd: "export SECONDLAYER_API_URL=https://api.secondlayer.tools SECONDLAYER_API_KEY=sk-sl_...",
	},
	{
		n: "03",
		tab: "Create",
		desc: "Infers schema, triggers, and handler from the contract's observed print events, into one file ready to edit or deploy as-is.",
		cmd: "secondlayer subgraphs create my-balances --from-contract SP....my-contract",
	},
	{
		n: "04",
		tab: "Deploy",
		desc: "It backfills from startBlock (set one: the event and transaction rows it reads bill) and keeps the table live as new blocks arrive.",
		cmd: "secondlayer subgraphs deploy subgraphs/my-balances.ts",
	},
	{
		n: "05",
		tab: "Query",
		desc: 'Rows serve the moment the first block lands; reads of your own tables are free. Same read from the SDK: sl.subgraphs.rows("my-balances", "balances").',
		cmd: 'curl -H "Authorization: Bearer $SECONDLAYER_API_KEY" "$SECONDLAYER_API_URL/v1/subgraphs/my-balances/balances"',
	},
];
