/**
 * The protocol data pages at /data/<slug>: one registry, one template. Every
 * call, field and trigger here is one the hosted API and SDK serve today; the
 * decoded-protocols section of /docs/index is the source of record.
 */
export type DataTopic = {
	slug: "pox5" | "sbtc" | "runes";
	eyebrow: string;
	/** The H1, in the words people search. */
	title: string;
	/** `<title>` before the root template appends the brand. */
	metaTitle: string;
	description: string;
	lede: string;
	curl: string;
	sdk: string;
	/** A real response, trimmed to the fields worth reading. */
	sampleResponse: string;
	/** The push: omitted when the protocol has nothing to subscribe to. */
	webhook: { lede: string; code: string } | null;
	docsHref: string;
	apiHref: string;
	libraryHref?: string;
	/** One line under the push, with an optional link after it. */
	extraLine?: { text: string; link?: { label: string; href: string } };
	/** Which keyless live aggregate the page shows above the API pitch. */
	stats: "sbtc" | "pox" | null;
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
		curl: `curl "https://api.secondlayer.tools/v1/index/pox5/events?topic=stake-update&limit=1&fields=block_height,staker,amount_ustx,unlock_cycle" \\
  -H "Authorization: Bearer sk-sl_…"`,
		sdk: `const { events } = await sl.index.pox5.events.list({
  topic: "stake-update",
  limit: 1,
  fields: ["block_height", "staker", "amount_ustx", "unlock_cycle"],
});`,
		sampleResponse: `{
  "events": [{
    "cursor": "9333163:59",
    "block_height": 9333163,
    "topic": "stake-update",
    "staker": "SP3EP7SQFX61NZY44QSAEESZJMQ9YV9QWRY4YAP9A",
    "amount_ustx": "1004900000",
    "unlock_cycle": 243
  }],
  "next_cursor": "9333163:59"
}`,
		webhook: {
			lede: "PoX-5 has no trigger of its own: it is a print event on the pox-5 contract. Narrow it to your signers with print fields.",
			code: `import { trigger } from "@secondlayer/sdk";

await sl.webhooks.create({
  name: "pox5-prints",
  url: "https://my-app.com/webhook",
  triggers: [
    trigger.printEvent({ contractId: "SP000000000000000000002Q6VF78.pox-5" }),
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
		curl: `curl "https://api.secondlayer.tools/v1/index/sbtc/withdrawals?limit=1&fields=request_id,status,amount,btc_confirmations,settlement_confirmed" \\
  -H "Authorization: Bearer sk-sl_…"`,
		sdk: `const { withdrawals } = await sl.index.sbtc.withdrawals.list({
  limit: 1,
  fields: ["request_id", "status", "amount", "btc_confirmations", "settlement_confirmed"],
});`,
		sampleResponse: `{
  "withdrawals": [{
    "cursor": "9331677:2",
    "request_id": 4610,
    "status": "ACCEPTED",
    "amount": "398000",
    "settlement_confirmed": true,
    "btc_confirmations": 12
  }],
  "next_cursor": "9331677:2"
}`,
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
		title: "Runes API: catalog, balances and activity",
		metaTitle: "Bitcoin Runes API: balances, activity and rune lookup",
		description:
			"Etched runes, per-rune activity and balances by address on Bitcoin, from one key and one call. Look up by id or name.",
		lede: "Every etched rune, its etch, mint, transfer and burn log, and balances by address. Look one up by id or name. One key, one call.",
		curl: `curl "https://api.secondlayer.tools/v1/index/runes?search=dog&limit=1" \\
  -H "Authorization: Bearer sk-sl_…"`,
		sdk: `const { runes } = await sl.index.runes.list({ search: "dog", limit: 1 });`,
		sampleResponse: `{
  "runes": [{
    "id": "840000:3",
    "name": "DOGGOTOTHEMOON",
    "spaced_name": "DOG•GO•TO•THE•MOON",
    "symbol": "🐕",
    "divisibility": 5,
    "supply": "10000000000000000",
    "etched_height": 840000
  }]
}`,
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
		stats: null,
		live: true,
	},
];

export const liveDataTopics = (): DataTopic[] =>
	DATA_TOPICS.filter((topic) => topic.live);

export const dataTopic = (slug: string): DataTopic | undefined =>
	liveDataTopics().find((topic) => topic.slug === slug);

export const dataPath = (topic: DataTopic) => `/data/${topic.slug}`;

/** The hosted keyless aggregate behind a page's live numbers. */
export const liveDataUrl = (stats: "sbtc" | "pox") =>
	`https://api.secondlayer.tools/public/data/${stats}`;
