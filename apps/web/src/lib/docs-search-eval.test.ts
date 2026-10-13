import { describe, expect, test } from "bun:test";
import vectors from "@/generated/docs-vectors.json";
import { buildIndex, confident, search } from "./docs-bm25";
import { fuse, fusedSure, shouldFind } from "./docs-find";
import queryVectors from "./docs-search-eval.vectors.json";
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

type Packed = { scale: number; q: string };

/** int8 base64 back to floats; both sides are stored at unit length. */
const unpack = ({ scale, q }: Packed) =>
	Array.from(new Int8Array(Buffer.from(q, "base64")), (i) => i * scale);

const sections = vectors.items.map((i) => ({ id: i.id, vec: unpack(i) }));

/** Top 30 sections by cosine to the stored query vector, as the API returns them. */
function nearest(query: string) {
	const q = unpack((queryVectors.queries as Record<string, Packed>)[query]);
	return sections
		.map(({ id, vec }) => ({
			id,
			cos: vec.reduce((sum, x, d) => sum + x * q[d], 0),
		}))
		.sort((a, b) => b.cos - a.cos)
		.slice(0, 30);
}

type Tally = { top1: number; top3: number; sure: number; sureWrong: number };

function summarize(t: Tally) {
	return `top-1 ${t.top1}/20, top-3 ${t.top3}/20, confident ${t.sure}, confident-wrong ${t.sureWrong}`;
}

describe("docs search eval", () => {
	test("every search candidate has a section vector from the same model", async () => {
		const have = new Set(vectors.items.map((i) => i.id));
		const missing = (await docsSearchDocs())
			.map((d) => d.id)
			.filter((id) => !have.has(id));
		expect(missing).toEqual([]);
		expect(vectors.model).toBe(queryVectors.model);
		expect(vectors.dims).toBe(queryVectors.dims);
	});

	test("paraphrase queries land on the section that answers them", async () => {
		const index = buildIndex(await docsSearchDocs());
		const text: Tally = { top1: 0, top3: 0, sure: 0, sureWrong: 0 };
		const fused: Tally = { top1: 0, top3: 0, sure: 0, sureWrong: 0 };
		const rows: string[] = [];
		const misses: string[] = [];
		for (const [query, expected] of EVAL) {
			const results = search(index, query, 30);
			const textTop = results.slice(0, 3).map((r) => idOf(r.id));
			const text1 = expected.includes(textTop[0]);
			const textSure = confident(results);
			text.top1 += text1 ? 1 : 0;
			text.top3 += textTop.some((id) => expected.includes(id)) ? 1 : 0;
			text.sure += textSure ? 1 : 0;
			text.sureWrong += textSure && !text1 ? 1 : 0;

			// What the reader sees: text results when sure, else the fused order.
			let top = textTop;
			let isSure = textSure;
			if (!textSure && shouldFind(query, false)) {
				const order = fuse(
					results.map((r) => ({ id: r.id, score: r.score })),
					nearest(query),
				);
				top = order.slice(0, 3).map((f) => idOf(f.id));
				isSure = fusedSure(order);
			}
			const hit1 = expected.includes(top[0]);
			const hit3 = top.some((id) => expected.includes(id));
			fused.top1 += hit1 ? 1 : 0;
			fused.top3 += hit3 ? 1 : 0;
			fused.sure += isSure ? 1 : 0;
			fused.sureWrong += isSure && !hit1 ? 1 : 0;
			rows.push(
				`${hit3 ? (hit1 ? "1" : "3") : "x"}${isSure ? " sure" : "     "} ${query} -> [${expected.join(" | ")}] got [${top.join(", ")}]`,
			);
			if (!hit1) {
				misses.push(
					`${hit3 ? "top3" : "miss"} ${query}: got [${top.join(", ")}]`,
				);
			}
		}
		const table = `text only: ${summarize(text)}\nfused:     ${summarize(fused)}\n${rows.join("\n")}`;
		console.log(table);
		expect(
			text.top3 >= 14 && text.sureWrong === 0,
			`text only: ${summarize(text)}`,
		).toBe(true);
		expect(fused.top3 >= 17 && fused.sureWrong <= 1, table).toBe(true);
	});
});
