/** Quickstart steps for the intro QuickstartPanel: one bare command each.
 *  The intro prose explains them. No sample output by design. */
export interface QuickstartStep {
	n: string;
	tab: string;
	cmd: string;
}

export const QUICKSTART_STEPS: QuickstartStep[] = [
	{
		n: "01",
		tab: "Install",
		cmd: "bun add -g @secondlayer/cli",
	},
	{
		n: "02",
		tab: "Variables",
		cmd: "export SECONDLAYER_API_URL=https://api.secondlayer.tools SECONDLAYER_API_KEY=sk-sl_...",
	},
	{
		n: "03",
		tab: "Create",
		cmd: "secondlayer subgraphs create my-balances --from-contract SP....my-contract",
	},
	{
		n: "04",
		tab: "Deploy",
		cmd: "secondlayer subgraphs deploy subgraphs/my-balances.ts",
	},
	{
		n: "05",
		tab: "Query",
		cmd: 'curl -H "Authorization: Bearer $SECONDLAYER_API_KEY" "$SECONDLAYER_API_URL/v1/subgraphs/my-balances/balances"',
	},
	{
		n: "06",
		tab: "Verify",
		cmd: "secondlayer verify block 9137005",
	},
];
