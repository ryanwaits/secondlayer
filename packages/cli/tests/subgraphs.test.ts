import { describe, expect, it } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createSubgraphDeployPreview,
	ensureScaffoldPackageJson,
	installScaffoldDependencies,
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

	it("runs bun install for scaffold output by default", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-scaffold-"));
		const binDir = mkdtempSync(join(tmpdir(), "sl-fake-bun-"));
		const originalPath = process.env.PATH;
		try {
			const callsPath = join(dir, "bun-call.json");
			const fakeBun = join(binDir, "bun");
			writeFileSync(
				fakeBun,
				`#!/bin/sh
printf '{"cwd":"%s","args":"%s"}\\n' "$PWD" "$*" > "${callsPath}"
`,
				"utf8",
			);
			chmodSync(fakeBun, 0o755);
			process.env.PATH = `${binDir}:${originalPath ?? ""}`;

			const result = await installScaffoldDependencies(dir);

			expect(result).toBe("installed");
			const call = JSON.parse(readFileSync(callsPath, "utf8"));
			expect(call).toEqual({ cwd: realpathSync(dir), args: "install" });
		} finally {
			process.env.PATH = originalPath;
			rmSync(dir, { recursive: true, force: true });
			rmSync(binDir, { recursive: true, force: true });
		}
	});

	it("rejects when default scaffold dependency installation fails", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-scaffold-"));
		const binDir = mkdtempSync(join(tmpdir(), "sl-fake-bun-"));
		const originalPath = process.env.PATH;
		try {
			const fakeBun = join(binDir, "bun");
			writeFileSync(
				fakeBun,
				`#!/bin/sh
exit 42
`,
				"utf8",
			);
			chmodSync(fakeBun, 0o755);
			process.env.PATH = `${binDir}:${originalPath ?? ""}`;

			await expect(installScaffoldDependencies(dir)).rejects.toThrow(
				"bun install exited with code 42",
			);
		} finally {
			process.env.PATH = originalPath;
			rmSync(dir, { recursive: true, force: true });
			rmSync(binDir, { recursive: true, force: true });
		}
	});

	it("can skip scaffold dependency installation", async () => {
		let called = false;
		const result = await installScaffoldDependencies("/tmp/example", {
			install: false,
			installer: async () => {
				called = true;
			},
		});

		expect(result).toBe("skipped");
		expect(called).toBe(false);
	});
});
