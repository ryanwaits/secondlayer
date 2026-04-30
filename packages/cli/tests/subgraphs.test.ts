import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createSubgraphDeployPreview,
	ensureScaffoldPackageJson,
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

	it("creates a module package file for scaffold output directories", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-scaffold-"));
		try {
			ensureScaffoldPackageJson(dir);
			const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			expect(pkg.type).toBe("module");
			expect(pkg.dependencies["@secondlayer/subgraphs"]).toBeString();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("adds the subgraphs dependency without overwriting existing package type", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-scaffold-"));
		try {
			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify({ type: "commonjs", dependencies: { zod: "^4.0.0" } }),
			);
			ensureScaffoldPackageJson(dir);
			const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			expect(pkg.type).toBe("commonjs");
			expect(pkg.dependencies.zod).toBe("^4.0.0");
			expect(pkg.dependencies["@secondlayer/subgraphs"]).toBeString();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
