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
import { Command } from "commander";
import {
	collectPinnedPrintSources,
	createSubgraphDeployPreview,
	ensureScaffoldPackageJson,
	formatOperationProgress,
	formatOperationRange,
	installScaffoldDependencies,
	operationDetailPairs,
	ormFlagsConflictingWithPayloads,
	parseStartBlockOption,
	parseSubgraphSpecFormat,
	registerSubgraphsCommand,
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

	it("parses subgraph spec formats", () => {
		expect(parseSubgraphSpecFormat()).toBe("openapi");
		expect(parseSubgraphSpecFormat("openapi")).toBe("openapi");
		expect(parseSubgraphSpecFormat("agent")).toBe("agent");
		expect(parseSubgraphSpecFormat("markdown")).toBe("markdown");
		expect(() => parseSubgraphSpecFormat("yaml")).toThrow(
			"--format must be one of: openapi, agent, markdown",
		);
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

	it("collects pinned print_event sources for payload codegen", () => {
		const pinned = collectPinnedPrintSources({
			deposits: {
				type: "print_event",
				contractId: "SP1.registry",
				topic: "completed-deposit",
			},
			allPrints: { type: "print_event", contractId: "SP1.registry" },
			traitPrints: {
				type: "print_event",
				contractId: "SP1.registry",
				trait: "sip-010",
			},
			wildcard: { type: "print_event" },
			calls: { type: "contract_call", contractId: "SP1.registry" },
		});
		expect(pinned).toEqual([
			{
				sourceName: "deposits",
				contractId: "SP1.registry",
				topic: "completed-deposit",
			},
			{ sourceName: "allPrints", contractId: "SP1.registry" },
		]);
	});

	it("rejects ORM-only codegen flags explicitly combined with --payloads", () => {
		// Commander fills --target/--env defaults, so only "cli"-sourced values conflict.
		const cliSourced = (...keys: string[]) =>
			ormFlagsConflictingWithPayloads((key) =>
				keys.includes(key) ? "cli" : "default",
			);
		expect(cliSourced()).toEqual([]);
		expect(cliSourced("target")).toEqual(["--target"]);
		expect(cliSourced("schema", "env", "modelsOnly")).toEqual([
			"--schema",
			"--env",
			"--models-only",
		]);
		// Flags outside the ORM set (e.g. --output) never conflict.
		expect(cliSourced("output", "payloads")).toEqual([]);
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

	it("labels an unbounded operation range as the whole subgraph", () => {
		expect(formatOperationRange({ fromBlock: null, toBlock: null })).toBe(
			"whole subgraph",
		);
		expect(formatOperationRange({ fromBlock: 100, toBlock: 200 })).toBe(
			"100 → 200",
		);
		expect(formatOperationRange({ fromBlock: 100, toBlock: null })).toBe(
			"100 → tip",
		);
	});

	it("shows an unknown operation progress as a dash, never 0%", () => {
		expect(formatOperationProgress(null)).toBe("—");
		expect(formatOperationProgress(0)).toBe("0.0%");
		expect(formatOperationProgress(0.4237)).toBe("42.4%");
		expect(formatOperationProgress(1)).toBe("100.0%");
	});

	it("surfaces the failure reason in a single operation view", () => {
		const pairs = operationDetailPairs({
			id: "op-1",
			subgraphName: "my-graph",
			kind: "backfill",
			status: "failed",
			fromBlock: 10,
			toBlock: 20,
			processedBlocks: 5,
			progress: 0.5,
			error: "handler threw",
			startedAt: "2026-08-16T00:00:00.000Z",
			finishedAt: null,
			createdAt: "2026-08-16T00:00:00.000Z",
			updatedAt: "2026-08-16T00:00:01.000Z",
		});
		expect(Object.fromEntries(pairs)).toMatchObject({
			ID: "op-1",
			Kind: "backfill",
			Status: "failed",
			Range: "10 → 20",
			Progress: "50.0%",
			Error: "handler threw",
			Finished: "—",
		});
	});
});

describe("subgraphs command surface", () => {
	const subcommands = () => {
		const program = new Command();
		registerSubgraphsCommand(program);
		const subgraphs = program.commands.find((c) => c.name() === "subgraphs");
		if (!subgraphs) throw new Error("subgraphs command not registered");
		return subgraphs.commands;
	};

	it("exposes the operation and source verbs", () => {
		const names = subcommands().map((c) => c.name());
		expect(names).toContain("operations");
		expect(names).toContain("source");
	});

	// Publishing claimed a name in a hosted global namespace; a self-hosted
	// instance has no such namespace. The verbs were deleted, not deprecated.
	it("no longer registers the public-namespace verbs", () => {
		const names = subcommands().flatMap((c) => [c.name(), ...c.aliases()]);
		expect(names).not.toContain("publish");
		expect(names).not.toContain("unpublish");
	});

	it("no longer accepts --visibility on deploy", () => {
		const deploy = subcommands().find((c) => c.name() === "deploy");
		expect(deploy?.options.map((o) => o.long)).not.toContain("--visibility");
	});

	it("takes an optional operation id for a single operation", () => {
		const operations = subcommands().find((c) => c.name() === "operations");
		expect(operations?.usage()).toContain("[operationId]");
	});

	it("stops an operation under `stop`, with `cancel` removed", () => {
		const commands = subcommands();
		expect(commands.find((c) => c.name() === "stop")).toBeDefined();
		expect(commands.flatMap((c) => [c.name(), ...c.aliases()])).not.toContain(
			"cancel",
		);
	});
});
