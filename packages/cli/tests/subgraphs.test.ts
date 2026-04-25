import { describe, expect, it } from "bun:test";
import {
	createSubgraphDeployPreview,
	parseStartBlockOption,
} from "../src/commands/subgraphs.ts";

describe("subgraphs command helpers", () => {
	it("parses deploy --start-block as a nonnegative integer", () => {
		expect(parseStartBlockOption()).toBeUndefined();
		expect(parseStartBlockOption("0")).toBe(0);
		expect(parseStartBlockOption("123")).toBe(123);
		expect(parseStartBlockOption(" 456 ")).toBe(456);
	});

	it("rejects invalid deploy --start-block values", () => {
		for (const value of ["-1", "1.5", "01", "abc", ""]) {
			expect(() => parseStartBlockOption(value)).toThrow(
				"--start-block must be a nonnegative integer",
			);
		}
		expect(() =>
			parseStartBlockOption(String(Number.MAX_SAFE_INTEGER + 1)),
		).toThrow("--start-block must be a safe integer");
	});

	it("summarizes deploy dry-run metadata", () => {
		const preview = createSubgraphDeployPreview(
			{
				name: "sbtc-activity",
				startBlock: 123,
				sources: {
					depositCalls: {
						type: "contract_call",
						contractId: "SP123.contract",
					},
				},
				schema: {
					deposits: {
						columns: {
							tx_id: { type: "text" },
							amount: { type: "uint" },
						},
					},
				},
				handlers: {
					depositCalls: () => {},
				},
			},
			{ bundleBytes: 2048 },
		);

		expect(preview).toMatchObject({
			name: "sbtc-activity",
			version: "(auto)",
			startBlock: "123",
			sources: "depositCalls",
			handlers: "depositCalls",
			tables: "deposits",
			bundleSize: "2048 bytes",
		});
		expect(preview.tableColumns).toEqual(["deposits: tx_id, amount"]);
	});
});
