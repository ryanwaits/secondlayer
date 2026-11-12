/**
 * The protocol data pages at /data/<slug>: one registry, one template. Every
 * call, field and trigger here is one the hosted API and SDK serve today; the
 * decoded-protocols section of /docs/index is the source of record.
 */
/** One way to get a number: the command and what it prints. */
export type DataExample = { code: string; output: string };

export type DataRecipe = { label: string; code: string; output: string };

/**
 * Stands in for the current PoX-5 reward cycle in the pox5 examples;
 * `liveExamples` fills it from the live numbers, else `FALLBACK_CYCLE`.
 */
export const CYCLE_TOKEN = "{cycle}";
export const FALLBACK_CYCLE = 147;

const CLIENT = `import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({ apiKey: process.env.SECONDLAYER_API_KEY });

`;

export type DataTopic = {
	slug: "pox5" | "sbtc" | "runes";
	eyebrow: string;
	/** The H1, in the words people search. */
	title: string;
	/** `<title>` before the root template appends the brand. */
	metaTitle: string;
	description: string;
	lede: string;
	/** The line under the H1 when live numbers are showing. */
	liveLede: string;
	/** "Get these numbers yourself": the section above the picker. */
	pick: { heading: string; lede: string };
	/** The first chip: the same numbers the page shows, three ways to get them. */
	examples: { free: DataExample; ts: DataExample; curl: DataExample };
	/** Exactly three chips after "These numbers", each a TypeScript call with a trimmed real output. */
	recipes: readonly DataRecipe[];
	/** The push: omitted when the protocol has nothing to subscribe to. */
	webhook: { lede: string; code: string } | null;
	docsHref: string;
	apiHref: string;
	libraryHref?: string;
	/** One line under the push, with an optional link after it. */
	extraLine?: { text: string; link?: { label: string; href: string } };
	/** Which keyless live aggregate the page shows above the picker. */
	stats: "sbtc" | "pox" | "runes";
	/** Draft topics stay out of routing, the sitemap, llms.txt and the footer. */
	live: boolean;
};

export const DATA_TOPICS: readonly DataTopic[] = [
	{
		slug: "pox5",
		eyebrow: "Stacks PoX-5",
		title: "PoX-5 stacking this cycle: total stacked, stakers, signers",
		metaTitle: "PoX-5 stacking data, live: total stacked, stakers, signers",
		description:
			"Live PoX-5 cycle totals and every signer's stacked STX, free with no key. Stakes, signers and bonds decoded through one API.",
		lede: "Every print from the pox-5 contract, decoded and filterable by staker, signer, bond or reward cycle. One key, one call.",
		liveLede: "The current answer, free with no key. Refreshed every minute.",
		pick: {
			heading: "Get these numbers yourself",
			lede: "The same JSON this page reads, with no key. Add a key for any past cycle, one staker's position or everything a signer did.",
		},
		examples: {
			free: {
				code: `curl -s https://api.secondlayer.tools/public/data/pox \\
  | jq '.current | {reward_cycle, total_stacked_ustx, stakers}'`,
				output: `{
  "reward_cycle": {cycle},
  // !mark[/513912288333589/]
  "total_stacked_ustx": "513912288333589",
  "stakers": 3399
}`,
			},
			ts: {
				code: `${CLIENT}const detail = await sl.index.pox.cycles.get({cycle});
for (const signer of detail?.cycle.signers ?? []) {
  console.log(signer.signer, signer.delegated_ustx);
}`,
				output: `SP1…4YDR.signer-manager                  89272590000000
SP3…FPJK.fastpool-max500-signer-manager  73983583000000
SP3…BYJH.signer-manager                  71276903000000
…`,
			},
			curl: {
				code: `curl https://api.secondlayer.tools/v1/index/pox/cycles/{cycle} \\
  -H "Authorization: Bearer $SECONDLAYER_API_KEY"`,
				output: `{
  "pox_version": 5,
  "cycle": {
    "reward_cycle": {cycle},
    "stakers": 3399,
    "signers": [ … ]
  }
}`,
			},
		},
		recipes: [
			{
				label: "One staker's position",
				code: `const { events } = await sl.index.pox5.events.list({
  staker: "SP2RQ1234AC8FPF9RMTNW79QDZ6EK7AJKFJE1719T",
  topic: "stake-update",
});`,
				output: `[{
  "block_height": 9453461,
  "signer": "SP8HK…ERSE.xverse-signer-manager-1",
  "amount_ustx": "1496000000",
  "unlock_cycle": 244
}]`,
			},
			{
				label: "Everything one signer did",
				code: `const { events } = await sl.index.pox5.events.list({
  signer: "SP8HK160YD5GHXP69VGA0TC7AQJ1X4CDW3XVERSE.xverse-signer-manager-1",
});`,
				output: `[{
  "block_height": 9453461,
  "topic": "stake-update",
  "staker": "SP2RQ…719T",
  "amount_ustx": "1496000000"
}]`,
			},
			{
				label: "Any past cycle",
				code: `const found = await sl.index.pox.cycles.get(146);
console.log(found?.cycle.total_stacked_ustx, found?.cycle.stakers);`,
				output: "493402397305177 3290",
			},
		],
		webhook: {
			lede: "PoX-5 has no trigger of its own: it is a print event on the pox-5 contract. Narrow it to your signers with print fields.",
			code: `import { trigger } from "@secondlayer/sdk";

await sl.webhooks.create({
  name: "pox5-prints",
  url: "https://my-app.com/webhook",
  triggers: [
    trigger.printEvent({
      contractId: "SP000000000000000000002Q6VF78.pox-5",
    }),
  ],
});`,
		},
		docsHref: "/docs/index#pox-5",
		apiHref: "/docs/api/index#list-pox5-events",
		libraryHref: "https://stacks.secondlayer.tools/guide/pox5",
		extraLine: {
			text: "Every row is an index you can check, not one you have to trust.",
			link: { label: "Check it yourself", href: "/verify" },
		},
		stats: "pox",
		live: true,
	},
	{
		slug: "sbtc",
		eyebrow: "sBTC on Stacks",
		title: "sBTC supply, deposits and withdrawals, live",
		metaTitle: "sBTC supply, deposits and withdrawals, live data",
		description:
			"Live sBTC supply, peg flow, deposits and withdrawals, free with no key. Withdrawal lifecycles with Bitcoin settlement through one API.",
		lede: "Completed deposits, withdrawal lifecycles with their Bitcoin confirmations, and peg totals. One key, one call.",
		liveLede: "The current answer, free with no key. Refreshed every minute.",
		pick: {
			heading: "Get these numbers yourself",
			lede: "The same JSON this page reads, with no key. Add a key for the full history: every deposit, every withdrawal and its Bitcoin settlement.",
		},
		examples: {
			free: {
				code: `curl -s https://api.secondlayer.tools/public/data/sbtc \\
  | jq .summary`,
				output: `{
  "total_deposits": 69849,
  "total_withdrawals_requested": 5138,
  "total_withdrawals_accepted": 4819,
  "total_withdrawals_rejected": 319,
  "net_peg_flow_sats": "248002744187",
  "total_locked_sats": "248002744187",
  "unmatched_withdrawal_accepts": 0,
  // !mark[/248002744187/]
  "sbtc_supply_sats": "248002744187"
}`,
			},
			ts: {
				code: `${CLIENT}const { summary } = await sl.index.sbtc.summary();
console.log(summary.sbtc_supply_sats);`,
				output: "248002744187",
			},
			curl: {
				code: `curl https://api.secondlayer.tools/v1/index/sbtc/summary \\
  -H "Authorization: Bearer $SECONDLAYER_API_KEY"`,
				output: `{
  "summary": {
    "sbtc_supply_sats": "248002744187",
    "total_deposits": 69849,
    …
  }
}`,
			},
		},
		recipes: [
			{
				label: "Recent deposits",
				code: "const { deposits } = await sl.index.sbtc.deposits.list({ limit: 1 });",
				output: `[{
  "block_height": 9452960,
  "amount": "29624",
  "fee": "376",
  "bitcoin_txid": "0x0cd2…c273"
}]`,
			},
			{
				label: "One withdrawal, through settlement",
				code: `const found = await sl.index.sbtc.withdrawals.get(4610);
console.log(found?.withdrawal.status, found?.withdrawal.accepted?.sweep_txid);`,
				output: "ACCEPTED 0xb2ae…1551",
			},
			{
				label: "Withdrawals from one sender",
				code: `const { withdrawals } = await sl.index.sbtc.withdrawals.list({
  sender: "SP206Y7BR5NFCR517VGVX04BSGNA5425GM6DMF9H",
});`,
				output: `[{ "request_id": 4610, "status": "ACCEPTED", "amount": "398000" }]`,
			},
		],
		webhook: {
			lede: "Be told when a peg-out settles on Bitcoin instead of polling for it.",
			code: `import { trigger } from "@secondlayer/sdk";

await sl.webhooks.create({
  name: "sbtc-settled",
  url: "https://my-app.com/webhook",
  triggers: [trigger.sbtcWithdrawalSweptConfirmed()],
});`,
		},
		docsHref: "/docs/index#sbtc",
		apiHref: "/docs/api/index#list-sbtc-withdrawals",
		libraryHref: "https://stacks.secondlayer.tools/reference/sbtc",
		extraLine: {
			text: "Emily tracks an operation in flight; this is the decoded history and the push.",
		},
		stats: "sbtc",
		live: true,
	},
	{
		slug: "runes",
		eyebrow: "Bitcoin Runes",
		title: "Runes on Bitcoin: most minted, balances, activity",
		metaTitle: "Bitcoin Runes API, live: most minted, balances and activity",
		description:
			"Live most-minted Bitcoin runes, free with no key. Balances by address, per-rune activity and name lookup through one API.",
		lede: "Every etched rune, its etch, mint, transfer and burn log, and balances by address. Look one up by id or name. One key, one call.",
		liveLede:
			"The current answer, free with no key. Refreshed every Bitcoin block.",
		pick: {
			heading: "Look up any rune yourself",
			lede: "The same JSON this page reads, with no key. Add a key for balances by address, a rune's full etch, mint, transfer and burn log, or lookups by name.",
		},
		examples: {
			free: {
				code: `curl -s https://api.secondlayer.tools/public/data/runes \\
  | jq '.most_minted[0]'`,
				output: `{
  "id": "1:0",
  "spaced_name": "UNCOMMON•GOODS",
  "symbol": "⧉",
  // !mark[/173834713/]
  "mints": "173834713",
  "supply": "173834713",
  "divisibility": 0
}`,
			},
			ts: {
				code: `${CLIENT}const { runes } = await sl.index.runes.list({ sort: "mints", limit: 5 });
for (const rune of runes) console.log(rune.spaced_name, rune.mints);`,
				output: `UNCOMMON•GOODS            173834713
COOK•THE•MEMPOOL            4309311
Z•Z•Z•Z•Z•FEHU•Z•Z•Z•Z•Z     1111111
…`,
			},
			curl: {
				code: `curl "https://api.secondlayer.tools/v1/index/runes?sort=mints&limit=5" \\
  -H "Authorization: Bearer $SECONDLAYER_API_KEY"`,
				output: `{
  "runes": [
    { "id": "1:0", "spaced_name": "UNCOMMON•GOODS", "mints": "173834713" },
    …
  ]
}`,
			},
		},
		recipes: [
			{
				label: "Balances for an address",
				code: `const { balances } = await sl.index.runes.balances({
  address: "bc1pkzvflutlq23anql0ttfsfajuyvd2zdaag6swyemuafym8x8z0q0sknmxfe",
});`,
				output: `[{
  "rune": { "spaced_name": "BOUND•BITCOIN", "symbol": "🐰" },
  "vout": 0,
  "amount": "510066469"
}, …]`,
			},
			{
				label: "One rune's activity",
				code: `const { events } = await sl.index.runes.activity.list({
  rune: "950387:2282",
  limit: 50,
});`,
				output: `[{
  "block_height": 975429,
  "kind": "rune_transfer",
  "amount": "2254829554",
  "address": "bc1pkzv…mxfe"
}, …]`,
			},
			{
				label: "Look one up by name",
				code: `const found = await sl.index.runes.get("DOG•GO•TO•THE•MOON");
console.log(found?.rune.id, found?.rune.supply);`,
				output: "840000:3 10000000000000000",
			},
		],
		webhook: {
			lede: "Get a post on every transfer of one rune. A name or an id both work.",
			code: `import { trigger } from "@secondlayer/sdk";

await sl.webhooks.create({
  name: "dog-transfers",
  url: "https://my-app.com/webhook",
  triggers: [trigger.runeTransfer({ rune: "840000:3" })],
});`,
		},
		docsHref: "/docs/index#runes",
		apiHref: "/docs/api/index#list-runes",
		stats: "runes",
		live: true,
	},
];

export const liveDataTopics = (): DataTopic[] =>
	DATA_TOPICS.filter((topic) => topic.live);

export const dataTopic = (slug: string): DataTopic | undefined =>
	liveDataTopics().find((topic) => topic.slug === slug);

export const dataPath = (topic: DataTopic) => `/data/${topic.slug}`;

/** The hosted keyless aggregate behind a page's live numbers. */
export const liveDataUrl = (stats: "sbtc" | "pox" | "runes") =>
	`https://api.secondlayer.tools/public/data/${stats}`;
