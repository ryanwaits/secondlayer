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
		tab: "Auth",
		title: "Authenticate",
		desc: "Magic-link sign-in: enter your email, then the 6-digit code from your inbox. Reads are public; deploying needs auth.",
		kw: "sl",
		rest: " login",
	},
	{
		n: "03",
		tab: "Create",
		title: "Create from a template",
		desc: "Scaffolds a one-file subgraph (schema, triggers, and handler), ready to edit or deploy as-is.",
		kw: "sl",
		rest: " subgraphs create my-balances --template sip-010-balances",
	},
	{
		n: "04",
		tab: "Deploy",
		title: "Deploy it",
		desc: "Indexes forward from the chain tip and keeps the table live as new blocks arrive; paid plans backfill full history.",
		kw: "sl",
		rest: " subgraphs deploy subgraphs/my-balances.ts",
	},
	{
		n: "05",
		tab: "Query",
		title: "Read it back",
		desc: 'Rows are live the moment the first block lands. Same read from the SDK — sl.subgraphs.rows("my-balances", "balances") — or straight over HTTP.',
		kw: "sl",
		rest: " subgraphs query my-balances balances --limit 10",
	},
];
