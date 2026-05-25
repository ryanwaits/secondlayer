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
		desc: "One global binary — works with bun, npm, or pnpm.",
		kw: "bun",
		rest: " add -g @secondlayer/cli",
	},
	{
		n: "02",
		tab: "Auth",
		title: "Authenticate",
		desc: "Opens your browser to sign in. Reads are public; deploying needs a key.",
		kw: "sl",
		rest: " auth login",
	},
	{
		n: "03",
		tab: "Deploy",
		title: "Deploy a subgraph",
		desc: "Secondlayer backfills history, then keeps the table live as new blocks arrive.",
		kw: "sl",
		rest: " subgraphs deploy ./subgraph.config.ts",
	},
	{
		n: "04",
		tab: "Query",
		title: "Query it",
		desc: "Live over REST immediately — no auth required to read.",
		kw: "curl",
		rest: ' https://api.secondlayer.tools/api/subgraphs/sbtc-flows/transfers -G -d "_limit=10"',
	},
];
