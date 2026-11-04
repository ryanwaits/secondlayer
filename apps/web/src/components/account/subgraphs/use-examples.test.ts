import { describe, expect, test } from "bun:test";
import {
	type Columns,
	type Lang,
	type Recipe,
	clientName,
	copyText,
	exampleFence,
} from "./use-examples";

const SUBGRAPH = "perf-test-sbtc";

const completedDeposit: Columns = {
	amount: { type: "uint" },
	burn_hash: { type: "text" },
	sweep_txid: { type: "text" },
	burn_height: { type: "uint" },
	bitcoin_txid: { type: "text" },
	output_index: { type: "uint" },
};
const withdrawalCreate: Columns = {
	amount: { type: "uint" },
	sender: { type: "principal" },
	max_fee: { type: "uint" },
	recipient: { type: "jsonb" },
	request_id: { type: "uint" },
	block_height: { type: "uint" },
};
const withdrawalReject: Columns = {
	request_id: { type: "uint" },
	signer_bitmap: { type: "uint" },
};

function fence(
	table: string,
	columns: Columns,
	recipe: Recipe,
	lang: Lang,
	sample: Record<string, unknown> | null = null,
) {
	return exampleFence({
		subgraph: SUBGRAPH,
		table,
		columns,
		sample,
		recipe,
		lang,
	});
}

const code = (...args: Parameters<typeof fence>) => fence(...args)?.code ?? "";

describe("use-in-your-app examples", () => {
	test("the filter matches on the first principal column, exactly", () => {
		const sdk = code("withdrawal_create", withdrawalCreate, "filter", "sdk");
		expect(sdk).toContain(`where: { sender: "SP…" },`);
		expect(
			code("withdrawal_create", withdrawalCreate, "filter", "cli"),
		).toContain("--filter 'sender=SP…'");
	});

	test("with no principal, the filter takes the first numeric column with gte", () => {
		const sdk = code("completed_deposit", completedDeposit, "filter", "sdk");
		expect(sdk).toContain("where: { amount: { gte: 0n } },");
		expect(
			code("completed_deposit", completedDeposit, "filter", "cli"),
		).toContain("--filter amount.gte=0 ");
	});

	test("with only a text column, the filter matches it exactly", () => {
		const sdk = code(
			"t",
			{ memo: { type: "text" }, data: { type: "jsonb" } },
			"filter",
			"sdk",
			{ memo: "hi" },
		);
		expect(sdk).toContain(`where: { memo: "hi" },`);
	});

	test("with no filterable column, the filter reads from the sample's block height", () => {
		const columns = { data: { type: "jsonb" } };
		expect(
			code("t", columns, "filter", "sdk", { _block_height: 9412519 }),
		).toContain("where: { _blockHeight: { gte: 9_412_519n } },");
		expect(code("t", columns, "filter", "sdk")).toContain(
			"where: { _blockHeight: { gte: 0n } },",
		);
		expect(
			code("t", columns, "filter", "curl", { _block_height: 5 }),
		).toContain('-d "_block_height.gte=5"');
	});

	test("a large uint sample is grouped with underscores in the SDK and plain in the CLI and cURL", () => {
		const sample = { amount: "120885000000" };
		expect(
			code("completed_deposit", completedDeposit, "filter", "sdk", sample),
		).toContain("gte: 120_885_000_000n");
		const cli = code(
			"completed_deposit",
			completedDeposit,
			"filter",
			"cli",
			sample,
		);
		expect(cli).toContain("--filter amount.gte=120885000000 ");
		expect(cli).not.toContain("120_885");
		expect(
			code("completed_deposit", completedDeposit, "filter", "curl", sample),
		).toContain('-d "amount.gte=120885000000"');
	});

	test("a small uint sample has no underscores", () => {
		expect(
			code("withdrawal_reject", withdrawalReject, "filter", "sdk", {
				request_id: 4817,
			}),
		).toContain("request_id: { gte: 4817n }");
	});

	test("a principal sample renders as a string literal", () => {
		const sender = "SP2YHVQD41BEAWT3YN8GD1S0ZQDGK0Z4WGN318Y9R";
		expect(
			code("withdrawal_create", withdrawalCreate, "filter", "sdk", { sender }),
		).toContain(`where: { sender: "${sender}" },`);
		expect(
			code("withdrawal_create", withdrawalCreate, "filter", "cli", { sender }),
		).toContain(`--filter sender=${sender} `);
	});

	test("the filter always reads newest first by block height", () => {
		expect(
			code("completed_deposit", completedDeposit, "filter", "sdk"),
		).toContain('orderBy: { _blockHeight: "desc" }');
		expect(
			code("completed_deposit", completedDeposit, "filter", "cli"),
		).toContain("--sort _block_height --order desc");
		const curl = code("completed_deposit", completedDeposit, "filter", "curl");
		expect(curl).toContain("_sort=_block_height");
		expect(curl).toContain("_order=desc");
	});

	test("count sums the first numeric column, and sums nothing without one", () => {
		expect(
			code("completed_deposit", completedDeposit, "count", "sdk"),
		).toContain('sum: ["amount"],');
		const none = code("t", { memo: { type: "text" } }, "count", "sdk");
		expect(none).toContain("aggregate({");
		expect(none).not.toContain("sum:");
		expect(
			code("completed_deposit", completedDeposit, "count", "curl"),
		).toContain("_sum=amount");
	});

	test("the CLI has no live example", () => {
		expect(
			fence("completed_deposit", completedDeposit, "live", "cli"),
		).toBeNull();
	});

	test("live starts from the sample's block height, and omits it without a sample", () => {
		expect(
			code("completed_deposit", completedDeposit, "live", "sdk", {
				_block_height: "9412519",
			}),
		).toContain("{ since: 9_412_519 },");
		const bare = code("completed_deposit", completedDeposit, "live", "sdk");
		expect(bare).not.toContain("since");
		expect(bare).toContain("subscribe((row) => console.log(row.amount));");
		const curl = code("completed_deposit", completedDeposit, "live", "curl", {
			_block_height: 9412519,
		});
		expect(curl).toContain("curl -N");
		expect(curl).toContain('-G -d "since=9412519"');
	});

	test("every cURL line but the last continues the command", () => {
		const lines = code(
			"completed_deposit",
			completedDeposit,
			"newest",
			"curl",
		).split("\n");
		expect(lines.length).toBe(3);
		for (const line of lines.slice(0, -1))
			expect(line.endsWith(" \\")).toBe(true);
		expect(lines[2]?.endsWith("\\")).toBe(false);
		expect(lines[1]).toContain("Authorization: Bearer $SECONDLAYER_API_KEY");
	});

	test("the SDK example imports the definition from the file name the Tables frame shows", () => {
		expect(
			code("completed_deposit", completedDeposit, "newest", "sdk"),
		).toContain('import definition from "./perf-test-sbtc";');
	});

	test("the SDK example is a full runnable file with the method on its own line", () => {
		const sdk = code("completed_deposit", completedDeposit, "newest", "sdk");
		expect(sdk).toContain("const perfTestSbtc = getSubgraph(definition);");
		expect(sdk).toContain("perfTestSbtc.completed_deposit.findMany({");
	});

	test("the SDK example has no callouts, collapses or marks", () => {
		for (const recipe of ["newest", "filter", "count", "live"] as const) {
			const sdk = code("withdrawal_create", withdrawalCreate, recipe, "sdk");
			expect(sdk).not.toMatch(/!callout|!collapse|!mark/);
		}
	});

	test("a tip never sits above an import line, and each stays short and plain", () => {
		for (const recipe of ["newest", "filter", "count", "live"] as const) {
			const lines = code(
				"withdrawal_create",
				withdrawalCreate,
				recipe,
				"sdk",
			).split("\n");
			const tips = lines.filter((line) => line.includes("!tip"));
			expect(tips.length).toBeLessThanOrEqual(2);
			lines.forEach((line, i) => {
				if (line.includes("!tip")) expect(lines[i + 1]).not.toMatch(/^import /);
			});
			for (const tip of tips) {
				const text = tip.replace(/^.*!tip\[[^\]]*\]\s*/, "");
				expect(text.length).toBeLessThanOrEqual(120);
				expect(text).not.toMatch(/https?:|—/);
			}
		}
	});

	test("each tip sits on the line where its method is used", () => {
		const lines = code(
			"completed_deposit",
			completedDeposit,
			"count",
			"sdk",
		).split("\n");
		const at = lines.findIndex((line) => line.includes("!tip[/aggregate/]"));
		expect(lines[at + 1]).toContain(".aggregate(");
	});

	test("copy text carries no tip lines", () => {
		const sdk = fence("completed_deposit", completedDeposit, "newest", "sdk");
		expect(sdk?.code).toContain("!tip");
		const text = copyText(sdk ?? { code: "", lang: "ts" });
		expect(text).not.toContain("!tip");
		expect(text).toContain("getSubgraph(definition)");
	});

	test("a client name camel-cases the subgraph name", () => {
		expect(clientName("perf-test-sbtc")).toBe("perfTestSbtc");
		expect(clientName("sbtc")).toBe("sbtc");
		expect(clientName("my_subgraph.v2")).toBe("mySubgraphV2");
		expect(clientName("2fa-watch")).toBe("subgraph2faWatch");
		expect(clientName("---")).toBe("subgraph");
	});
});
