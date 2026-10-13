import { describe, expect, test } from "bun:test";
import apiNav from "@/generated/openapi-nav.json";
import { docsSearchPool } from "./command-center/items";
import { rankCommandItems } from "./command-center/search";
import { docsHeadingIndex } from "./docs-source";

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
	test.skip("paraphrase queries land on the section that answers them", async () => {
		const pool = docsSearchPool(await docsHeadingIndex(), apiNav);
		let top1 = 0;
		let top3 = 0;
		const rows: string[] = [];
		for (const [query, expected] of EVAL) {
			const top = rankCommandItems(query, pool, new Map())
				.flat.slice(0, 3)
				.map((s) => idOf(s.item.id));
			const hit1 = expected.includes(top[0]);
			const hit3 = top.some((id) => expected.includes(id));
			if (hit1) top1++;
			if (hit3) top3++;
			rows.push(
				`${hit3 ? (hit1 ? "1" : "3") : "x"} ${query} -> [${expected.join(" | ")}] got [${top.join(", ")}]`,
			);
		}
		const table = `top-1 ${top1}/20, top-3 ${top3}/20\n${rows.join("\n")}`;
		expect(top1 >= 16 && top3 >= 18, table).toBe(true);
	});
});
