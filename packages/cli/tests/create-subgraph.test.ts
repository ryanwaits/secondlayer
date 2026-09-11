import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerSubgraphsCommand } from "../src/commands/subgraphs.ts";

describe("subgraphs create", () => {
	it("without flags exits 1 and does not write an unscoped FT indexer", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-create-"));
		try {
			const proc = Bun.spawn(
				[
					process.execPath,
					"run",
					join(import.meta.dir, "../src/cli.ts"),
					"subgraphs",
					"create",
					"nope",
				],
				{
					cwd: dir,
					env: { ...process.env, SL_API_URL: "http://127.0.0.1:1" },
					stdin: "ignore",
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			expect(exitCode).toBe(1);
			expect(stdout + stderr).toMatch(/--from-contract|--trait|--blank/);
			expect(() =>
				readFileSync(join(dir, "subgraphs", "nope.ts"), "utf8"),
			).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30_000);

	it("create registers --from-contract, --trait, and --blank", () => {
		const program = new Command();
		registerSubgraphsCommand(program);
		const create = program.commands
			.find((c) => c.name() === "subgraphs")
			?.commands.find((c) => c.name() === "create");
		const longs = create?.options.map((o) => o.long) ?? [];
		expect(longs).toContain("--from-contract");
		expect(longs).toContain("--trait");
		expect(longs).toContain("--blank");
	});

	it("add registers --from-contract", () => {
		const program = new Command();
		registerSubgraphsCommand(program);
		const add = program.commands
			.find((c) => c.name() === "subgraphs")
			?.commands.find((c) => c.name() === "add");
		expect(add).toBeDefined();
		expect(add?.options.map((o) => o.long)).toContain("--from-contract");
	});
});
