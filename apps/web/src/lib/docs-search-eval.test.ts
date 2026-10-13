import { describe, expect, test } from "bun:test";
import { buildIndex, confident, search } from "./docs-bm25";
import { docsSearchDocs } from "./docs-source";

/**
 * Fixed paraphrase queries, each mapped to the docs section(s) that answer it.
 * Written before any phrasing was generated; do not retune either side to the
 * other. An id is `href#anchor` for a section, `href` for a page.
 */
const EVAL: [query: string, expected: string[]][] = [
	[
		"why are my rows doubled after a fork",
		[
			"/docs/index#reorgs",
			"/docs/streams#reorg-behavior",
			"/docs/deploy#make-writes-idempotent",
		],
	],
	["resume where my consumer stopped", ["/docs/sdk#checkpointed-consumer"]],
	[
		"is my webhook signed",
		[
			"/docs/webhooks/deliveries#verify-the-signature",
			"/docs/authentication#webhook-signing-secrets",
		],
	],
	[
		"prove a block is real",
		["/docs/verification#check-a-block", "/docs/verification"],
	],
	["run it on my own server", ["/docs/self-host"]],
	[
		"how much does it cost per million rows",
		["/docs/authentication#what-it-costs"],
	],
	["my webhook receiver is down", ["/docs/webhooks#receiver-down"]],
	[
		"backfill from genesis",
		["/docs/streams#cold-history", "/docs/archive#restore-a-fresh-instance"],
	],
	[
		"get notified when sbtc is deposited",
		["/docs/webhooks#protocol-triggers", "/docs/webhooks"],
	],
	[
		"turn my contract into a table",
		["/docs/cli#scaffold-from-a-contract", "/docs/subgraphs#define-a-subgraph"],
	],
	[
		"type safe client for my events",
		[
			"/docs/cli#generate-typed-contract-clients",
			"/docs/subgraphs/handlers#typed-print-payloads",
		],
	],
	["what changed in the latest release", ["/docs/changelog"]],
	["how do i get an api key", ["/docs/authentication#your-key"]],
	[
		"stream raw events from the chain",
		[
			"/docs/streams#real-time-firehose-sse",
			"/docs/streams#read-it-directly",
			"/docs/streams",
		],
	],
	["delete rows after a reorg", ["/docs/sinks#rollback-is-height-stamped"]],
	[
		"run tests against a local chain",
		["/docs/devnet", "/docs/devnet#start-the-devnet"],
	],
	["hook up claude to secondlayer", ["/docs/mcp#connect", "/docs/mcp"]],
	[
		"export everything to parquet",
		["/docs/streams#dumps-and-duckdb", "/docs/archive#what-the-archive-is"],
	],
	["how big a machine do i need", ["/docs/self-host/hardware"]],
	[
		"query rows over http without the sdk",
		["/docs/index#plain-http", "/docs/rest-api"],
	],
];

const idOf = (itemId: string) => itemId.replace(/^docs:/, "");

describe("docs search eval", () => {
	test("paraphrase queries land on the section that answers them", async () => {
		const index = buildIndex(await docsSearchDocs());
		let top1 = 0;
		let top3 = 0;
		let sure = 0;
		let sureWrong = 0;
		const rows: string[] = [];
		for (const [query, expected] of EVAL) {
			const results = search(index, query, 5);
			const top = results.slice(0, 3).map((r) => idOf(r.id));
			const hit1 = expected.includes(top[0]);
			const hit3 = top.some((id) => expected.includes(id));
			const isSure = confident(results);
			if (hit1) top1++;
			if (hit3) top3++;
			if (isSure) sure++;
			if (isSure && !hit1) sureWrong++;
			rows.push(
				`${hit3 ? (hit1 ? "1" : "3") : "x"}${isSure ? " sure" : "     "} ${query} -> [${expected.join(" | ")}] got [${top.join(", ")}]`,
			);
		}
		const table = `top-1 ${top1}/20, top-3 ${top3}/20, confident ${sure}, confident-wrong ${sureWrong}\n${rows.join("\n")}`;
		console.log(table);
		expect(top3 >= 14 && sureWrong === 0, table).toBe(true);
	});
});
