import type { Insight } from "./insights";

/**
 * Example insights for tests and lab stories. Example names and round numbers
 * only: never real account data.
 */

/** 36 ten-minute windows of matched events, steady around 7. */
const MATCHED = Array.from({ length: 36 }, (_, i) => 6 + ((i * 5) % 4));
/** The same windows as delivered: the receiver stops answering halfway. */
const DELIVERED = MATCHED.map((v, i) => (i >= 18 ? 0 : v));

const P95_SECONDS = [
	1.2, 1.3, 1.5, 1.6, 1.9, 2.1, 2.4, 2.8, 3.1, 3.6, 4, 4.6, 5.2, 5.9,
];

/** p95 ms by day for the last 14 days; the incident day is index 10. */
const P95_BY_DAY = [
	240, 250, 235, 260, 245, 255, 240, 250, 260, 245, 5800, 250, 240, 255,
];
const P95_INCIDENT = P95_BY_DAY.map((_, i) => (i === 10 ? 1 : 0));

/** Calls per minute over the last hour: mostly 6, a few with rows. */
const POLL_CALLS = Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? 1 : 6));

export const FIXTURE_INSIGHTS: Insight[] = [
	{
		id: "ins-receiver-down",
		rule: "receiver_down",
		severity: "losing",
		impact: 214,
		resource: { kind: "webhook", id: "wh-deposits", name: "sbtc-deposits" },
		line: "Receiver returning 502 since 16:06",
		meta: "214 waiting to retry",
		lead: "Your receiver is down, not the chain.",
		body: "Events still match at the usual ~42 an hour, but hooks.example.dev has answered every delivery since 16:06 with 502 from nginx. Nothing is lost: 214 deliveries are queued and retry on their own.",
		evidence: [
			{
				kind: "series",
				title: "Matched vs delivered · 10-min windows, last 6h",
				series: [
					{ name: "Matched on chain", role: "context", points: MATCHED },
					{ name: "Delivered to you", role: "a", points: DELIVERED },
				],
				labels: [
					[0, "-6h"],
					[18, "-3h"],
					[35, "now"],
				],
			},
			{
				kind: "shapes",
				title: "What your receiver sent back",
				shapes: [
					{
						code: "502",
						body: "<html><head><title>502 Bad Gateway</title></head> nginx",
						count: 214,
						isNew: true,
					},
					{
						code: "504",
						body: "<html><head><title>504 Gateway Time-out</title></head> nginx",
						count: 9,
						isNew: true,
					},
				],
			},
		],
		handoff: {
			prompt:
				'My Secondlayer webhook "sbtc-deposits" has been failing since 16:06 UTC. The receiver hooks.example.dev returns HTTP 502 from nginx on every delivery. 214 deliveries are queued to retry. Chain matches are normal (about 42 an hour), so the problem is the receiver. Check the service behind nginx on hooks.example.dev, then confirm deliveries resume.',
			commands: [
				"sl webhooks doctor sbtc-deposits",
				"sl webhooks dead sbtc-deposits",
			],
		},
		how: {
			detector:
				"delivered < 20% of the 7-day median for this hour, 3 windows in a row",
			facts: [
				["matched", "42/h  7-day median 42/h"],
				["delivered", "0/h since 16:06"],
				["responses", "502 x214  504 x9  server: nginx"],
				["recipe", "docs/webhooks#receiver-errors"],
			],
			label: { cause: "receiver_down", confidence: 0.93 },
		},
		createdAt: "2026-10-15T16:20:00.000Z",
	},
	{
		id: "ins-tls-expiring",
		rule: "tls_expiring",
		severity: "will_fail",
		impact: 312,
		resource: { kind: "webhook", id: "wh-deposits", name: "sbtc-deposits" },
		line: "The TLS certificate for hooks.example.dev expires in 9 days",
		meta: "Oct 24",
		lead: "Auto-renewal looks stuck.",
		body: "We see your certificate on every delivery. It expires Oct 24, and certificates from this issuer usually renew 30 days early. After that, every delivery fails with a TLS error.",
		evidence: [
			{
				kind: "table",
				title: "Certificate",
				columns: ["Field", "Value"],
				rows: [
					["Issuer", "Example CA R1"],
					["Issued", "Jul 26"],
					["Expires", "Oct 24, 09:12 UTC"],
				],
			},
		],
		handoff: {
			prompt:
				'The TLS certificate that hooks.example.dev presents to my Secondlayer webhook "sbtc-deposits" expires on Oct 24 at 09:12 UTC. Its issuer usually renews 30 days early, so auto-renewal has probably stopped. Find how the certificate on hooks.example.dev is renewed and fix the renewal before the expiry.',
			commands: ["sl webhooks doctor sbtc-deposits"],
		},
		how: {
			detector:
				"certificate notAfter minus now < 14 days, seen on 312 deliveries",
			facts: [["issuer", "Example CA R1  expires Oct 24"]],
			label: { cause: "renewal_missed", confidence: 0.9 },
		},
		createdAt: "2026-10-15T09:00:00.000Z",
	},
	{
		id: "ins-duplicate-webhook",
		rule: "duplicate_webhook",
		severity: "costs",
		impact: 120,
		resource: { kind: "webhook", id: "wh-deposits", name: "sbtc-deposits" },
		line: "sbtc-deposits-v2 does the same job",
		meta: "same filter, same receiver",
		lead: "Every event goes out twice and is billed twice.",
		body: "If v2 replaced this one, delete one of them. Your receiver also has to handle the duplicates.",
		evidence: [],
		handoff: {
			prompt:
				'My Secondlayer webhooks "sbtc-deposits" and "sbtc-deposits-v2" have the same filter and the same receiver, so every event is delivered and billed twice. Work out which one is still needed. If v2 replaced the original, delete the one that is not used.',
			commands: ["sl webhooks delete sbtc-deposits-v2"],
		},
		how: {
			detector: "two webhooks on one account with identical filter and url",
			facts: [["match", "filter equal, receiver equal"]],
		},
		createdAt: "2026-10-14T12:00:00.000Z",
	},
	{
		id: "ins-retries-recovered",
		rule: "retries_recovered",
		severity: "recovered",
		impact: 4,
		resource: { kind: "webhook", id: "wh-deposits", name: "sbtc-deposits" },
		line: "Retries on Oct 12",
		meta: "recovered, nothing lost",
		lead: "Recovered on its own.",
		body: "4 deliveries got a 503 between 02:10 and 02:14 UTC and went through on the first retry.",
		evidence: [],
		handoff: {
			prompt:
				'My Secondlayer webhook "sbtc-deposits" returned 503 for 4 deliveries between 02:10 and 02:14 UTC on Oct 12. All of them went through on the first retry. Nothing needs to change unless this repeats.',
			commands: ["sl webhooks deliveries sbtc-deposits"],
		},
		how: {
			detector: "attempts failed, then succeeded on retry, no dead deliveries",
			facts: [["attempts", "4 failed  4 retried ok  0 dead"]],
		},
		createdAt: "2026-10-12T02:30:00.000Z",
		resolvedAt: "2026-10-12T02:40:00.000Z",
	},
	{
		id: "ins-dns-retries-recovered",
		rule: "dns_retries_recovered",
		severity: "recovered",
		impact: 3,
		resource: { kind: "webhook", id: "wh-transfers", name: "sbtc-transfers" },
		line: "Slow, then three DNS timeouts",
		meta: "recovered, nothing lost",
		lead: "Slow, then three DNS timeouts. Nothing lost.",
		body: "On Oct 8 between 18:57 and 23:05 UTC, looking up hooks.example.dev timed out 3 times and responses slowed to a p95 of 5.8 s (it is usually about 250 ms). Every event went through on a retry.",
		evidence: [
			{
				kind: "series",
				title: "p95 response time by day",
				series: [
					{ name: "p95", role: "a", points: P95_BY_DAY },
					{ name: "Incident", role: "mark", points: P95_INCIDENT },
				],
				labels: [
					[0, "1"],
					[7, "8"],
					[13, "14"],
				],
				unit: "ms",
			},
			{
				kind: "timeline",
				title: "The worst one · block 9,149,574",
				steps: [
					{
						what: "Attempt 1 · DNS",
						at: "19:02:04",
						note: "timed out",
						failed: true,
					},
					{
						what: "Attempt 2 · DNS",
						at: "+30s",
						note: "timed out",
						failed: true,
					},
					{ what: "Attempt 3 · 200", at: "+2m", note: "41 ms", failed: false },
				],
			},
		],
		handoff: {
			prompt:
				'My Secondlayer webhook "sbtc-transfers" had 3 DNS timeouts looking up hooks.example.dev on Oct 8 between 18:57 and 23:05 UTC, and its p95 rose to 5.8 s (usually about 250 ms). Every event went through on a retry. Check the status history of my DNS provider for that window.',
			commands: ["sl webhooks deliveries sbtc-transfers"],
		},
		how: {
			detector:
				"p95 > 5x the 7-day p95, or any attempt failed with no response",
			facts: [
				["attempts", "12 on Oct 8  3 failed  3 retried ok  0 dead"],
				["p95", "5,824 ms  7-day p95 ~250 ms"],
				["errors", "DNS resolution failed (ETIMEOUT) x3"],
			],
			label: { cause: "dns_timeout", confidence: 0.61 },
		},
		createdAt: "2026-10-08T23:30:00.000Z",
		resolvedAt: "2026-10-09T00:00:00.000Z",
	},
	{
		id: "ins-duplicate-reads",
		rule: "duplicate_reads",
		severity: "costs",
		impact: 3587,
		resource: { kind: "account", id: "acct-example", name: "Account" },
		line: "The same five pages were read twice",
		meta: "billed twice",
		lead: "A read loop starts over instead of resuming.",
		body: "Two runs an hour apart got the same five pages in the same order with the same key. Each repeat is billed.",
		evidence: [
			{
				kind: "table",
				title: "Page sizes, by run",
				columns: ["Page", "Run 1", "Run 2"],
				rows: [
					[1, 1000, 1000],
					[2, 1000, 1000],
					[3, 391, 391],
					[4, 194, 194],
					[5, 2, 2],
				],
			},
		],
		handoff: {
			prompt:
				"My app reads the Secondlayer index events endpoint. Twice today the same five pages came back in the same order (1000, 1000, 391, 194 and 2 rows) with the same API key, so a read loop starts over instead of resuming. Each repeat is billed. Find the code that pages through the index events and check whether the cursor is kept between runs.",
			commands: [],
		},
		how: {
			detector: "same cursor chain replayed by one key within 24h",
			facts: [["pages", "1000, 1000, 391, 194, 2 in both runs"]],
			label: { cause: "cursor_not_saved", confidence: 0.88 },
		},
		createdAt: "2026-10-15T18:57:00.000Z",
	},
	{
		id: "ins-filter-cannot-match",
		rule: "filter_cannot_match",
		severity: "will_fail",
		impact: 3,
		resource: { kind: "webhook", id: "wh-vault-admin", name: "vault-admin" },
		line: "vault-admin can't match anything",
		meta: "0 hits replaying 90 days",
		lead: "That function isn't on the contract.",
		body: "This webhook listens for set-impl on the vault contract, but the contract has no function by that name. It has set-implementation, called 3 times in 90 days. You would have missed all 3.",
		evidence: [
			{
				kind: "table",
				title: "Calls to the vault contract · 90 days",
				columns: ["Function", "Calls"],
				rows: [
					["set-impl (your filter)", "not on contract"],
					["set-implementation", 3],
					["deposit", 4812],
					["withdraw", 2190],
				],
				markRow: 0,
			},
		],
		handoff: {
			prompt:
				'My Secondlayer webhook "vault-admin" listens for contract calls to SP3FB…X4Q.vault with functionName "set-impl". That contract has no function by that name. The closest is "set-implementation", called 3 times in the last 90 days, and the webhook matched none of them. Find where this webhook is created and check the function name. Filters cannot be edited in place: create the corrected webhook, then delete vault-admin.',
			commands: ["sl webhooks delete vault-admin"],
		},
		how: {
			detector: "replayed the filter over the last 90 days: 0 matches",
			facts: [["contract", "no set-impl, closest: set-implementation"]],
			label: { cause: "function_not_on_contract", confidence: 0.97 },
		},
		createdAt: "2026-10-15T08:00:00.000Z",
	},
	{
		id: "ins-fake-success-200",
		rule: "fake_success_200",
		severity: "losing",
		impact: 312,
		resource: { kind: "webhook", id: "wh-mint-alerts", name: "mint-alerts" },
		line: "mint-alerts gets 200s that aren't",
		meta: "your host's login page since 14:12",
		lead: "Delivered, but your app never saw them.",
		body: "Since 14:12 your receiver answers with a login page and a 200, so 312 events count as delivered. They did not reach your code. Usually a deploy turned on login protection for every route.",
		evidence: [
			{
				kind: "shapes",
				title: "What your receiver sent back",
				shapes: [
					{
						code: "200",
						body: 'text/html · "Log in to continue"',
						count: 312,
						isNew: true,
					},
					{
						code: "200",
						body: 'application/json · {"received":true}',
						count: 0,
						isNew: false,
					},
				],
			},
		],
		handoff: {
			prompt:
				'Since 14:12 UTC my webhook endpoint for Secondlayer ("mint-alerts") answers 200 with an HTML login page ("Log in to continue") instead of my JSON. 312 events were acknowledged but never reached my code. Check what changed in hosting or auth config around 14:12 and make the webhook route reachable without a login. Then resend the missed events.',
			commands: [
				"sl webhooks replay mint-alerts --from-block 9216880 --to-block 9218416 -y",
			],
		},
		how: {
			detector:
				"2xx with a body unlike the last 7 days (html vs json), 312 in a row",
			facts: [["body", "login_wall"]],
			label: { cause: "login_wall", confidence: 0.96 },
		},
		createdAt: "2026-10-15T14:30:00.000Z",
	},
	{
		id: "ins-receiver-slowing",
		rule: "receiver_slowing",
		severity: "will_fail",
		impact: 14,
		resource: { kind: "webhook", id: "wh-deposits", name: "sbtc-deposits" },
		line: "sbtc-deposits is getting slower",
		meta: "p95 1.2 s to 5.9 s in 14 days",
		lead: "Nothing fails yet. At this pace it will around Oct 22.",
		body: "Your receiver's p95 has grown every day for two weeks. Our timeout is 10 s. The rise is steady, not spiky, which usually means each request does more work over time, like a table scan or a growing queue.",
		evidence: [
			{
				kind: "series",
				title: "p95 response time · 14 days",
				series: [
					{
						name: "Our timeout",
						role: "context",
						points: P95_SECONDS.map(() => 10),
					},
					{ name: "Your p95", role: "a", points: P95_SECONDS },
				],
				labels: [
					[0, "-14d"],
					[7, "-7d"],
					[13, "today"],
				],
				unit: "s",
			},
		],
		handoff: {
			prompt:
				'My Secondlayer webhook receiver for "sbtc-deposits" keeps getting slower: p95 went from 1.2 s to 5.9 s over 14 days, and deliveries time out at 10 s. The rise is steady, not spiky. Look at what the handler does per request (queries, scans, queues) and what grows over time.',
			commands: ["sl webhooks deliveries sbtc-deposits"],
		},
		how: {
			detector:
				"p95 up 13 of 14 days, linear fit r2=0.97, crosses 10,000 ms in about 7 days",
			facts: [["shape", "steady_growth"]],
			label: { cause: "steady_growth", confidence: 0.91 },
		},
		createdAt: "2026-10-15T07:00:00.000Z",
	},
	{
		id: "ins-handler-errors",
		rule: "handler_errors",
		severity: "losing",
		impact: 1204,
		resource: { kind: "subgraph", id: "sg-flows", name: "sbtc-flows" },
		line: "sbtc-flows · 1,204 handler errors, 2 kinds",
		meta: "98% on burn events",
		lead: "Every error comes from burn events.",
		body: "1,180 failed in one handler, all on ft_burn, the only event type here without a recipient. Transfers and mints run fine. The other 24 errors are retries of rows that already existed, and those are harmless.",
		evidence: [
			{
				kind: "table",
				title: "Errors, grouped",
				columns: ["Error", "Count"],
				rows: [
					["TypeError: reading 'toString' · handlers.ts:42", 1180],
					["duplicate key · flows_pkey", 24],
				],
				markRow: 0,
			},
		],
		handoff: {
			prompt:
				'My Secondlayer subgraph "sbtc-flows" logged 1,180 handler errors in 24h: TypeError reading toString at handlers.ts:42. Every one came from an ft_burn event, the only event type here without a recipient. ft_transfer and ft_mint run fine. Check how the handler reads recipient on burns. After a fix, deploy it and check the subgraph for skipped blocks.',
			commands: ["sl subgraphs gaps sbtc-flows"],
		},
		how: {
			detector: "1,204 handler errors in 24h, clustered by stack frame",
			facts: [["pattern", "100% on ft_burn, 0% on ft_transfer and ft_mint"]],
			label: { cause: "field_missing_on_event_type", confidence: 0.94 },
		},
		createdAt: "2026-10-15T12:00:00.000Z",
	},
	{
		id: "ins-polling-loop",
		rule: "polling_loop",
		severity: "costs",
		impact: 8600,
		resource: { kind: "account", id: "acct-example", name: "Account" },
		line: "A loop asks for vault events every 10 s",
		meta: "94% of calls come back empty",
		lead: "A webhook would bring them to you.",
		body: "One key calls the streams events endpoint for one contract every 10 seconds, about 8,600 times a day. Most calls return nothing. A webhook delivers each event about a second after its block. At your volume the cost is about the same.",
		evidence: [
			{
				kind: "series",
				title: "Calls per minute · last hour",
				series: [{ name: "Calls", role: "a", points: POLL_CALLS }],
				labels: [
					[0, "-60m"],
					[30, "-30m"],
					[59, "now"],
				],
			},
		],
		handoff: {
			prompt:
				"My app calls the Secondlayer streams events endpoint for one contract every 10 s, about 8,600 calls a day, and 94% come back empty. Find that polling loop and consider a Secondlayer webhook on the same filter instead, so events arrive about a second after each block. Cost is about the same at this volume.",
			commands: [],
		},
		how: {
			detector:
				"same path and filters every 10 s (plus or minus 1) for 6 h from one key, 94% empty pages",
			facts: [["cost", "about 60 events/day, both under $0.01/day"]],
			label: { cause: "polling_loop", confidence: 0.93 },
		},
		createdAt: "2026-10-15T10:00:00.000Z",
	},
	{
		id: "ins-cap-pace",
		rule: "cap_pace",
		severity: "will_fail",
		impact: 12,
		resource: { kind: "account", id: "acct-example", name: "Account" },
		line: "At this pace you hit your $50 cap on Oct 27",
		meta: "4 days early",
		lead: "Your spend cap will stop everything before the month ends.",
		body: "You have spent $31 so far and the last seven days average $2.60 a day. At that pace you reach the $50 cap on Oct 27. At a cap everything stops, webhooks included, until you raise it or add credits.",
		evidence: [
			{
				kind: "table",
				title: "Spend against the cap",
				columns: ["", "Amount"],
				rows: [
					["Spent this month", "$31.00"],
					["Last 7 days, per day", "$2.60"],
					["Cap", "$50.00"],
				],
			},
		],
		handoff: {
			prompt:
				"My Secondlayer account has spent $31 this month against a $50 cap, and the last seven days average $2.60 a day, so the cap is reached on Oct 27. Work out which of my webhooks, subgraphs or reads cost the most this week and whether the cap should be raised.",
			commands: [],
		},
		how: {
			detector:
				"spend to date plus the 7-day daily average, projected to the cap",
			facts: [["projected", "cap reached Oct 27"]],
		},
		createdAt: "2026-10-15T09:00:00.000Z",
	},
];

/** The four insights of the ranked-stack story, in no particular order. */
export const FIXTURE_STACK: Insight[] = [
	FIXTURE_INSIGHTS[3],
	FIXTURE_INSIGHTS[0],
	FIXTURE_INSIGHTS[2],
	FIXTURE_INSIGHTS[1],
].filter((i): i is Insight => i !== undefined);
