import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedArchive } from "@secondlayer/sdk";
import { Command } from "commander";
import { registerArchiveCommand, runLatest, runQuote } from "./archive.ts";
import { registerVerifyCommand } from "./verify.ts";

function captureExit(): {
	codes: number[];
	restore: () => void;
} {
	const codes: number[] = [];
	const original = process.exit;
	process.exit = ((code?: number) => {
		codes.push(code ?? 0);
		throw new Error(`process.exit:${code ?? 0}`);
	}) as typeof process.exit;
	return {
		codes,
		restore: () => {
			process.exit = original;
		},
	};
}

const loadedFixture: LoadedArchive = {
	manifest: {
		coverage: { from_block: 0, to_block: 99 },
		partitions: [
			{
				dataset: "blocks",
				from_block: 0,
				to_block: 99,
				path: "blocks/0-99.parquet",
				row_count: 100,
				byte_size: 10,
				sha256: "a".repeat(64),
			},
		],
		published_at: "2026-01-01T00:00:00.000Z",
		digest: "abc123",
	},
	origin: "https://archive.secondlayer.tools/latest.json",
	root: "https://archive.secondlayer.tools",
	isRemote: true,
	signature: { verified: true },
};

describe("secondlayer archive", () => {
	test("registers verify, repair, bootstrap, quote, latest", () => {
		const program = new Command();
		registerArchiveCommand(program);
		const archive = program.commands.find((c) => c.name() === "archive");
		expect(archive).toBeDefined();
		const names = (archive?.commands ?? []).map((c) => c.name());
		expect(names).toEqual(["verify", "repair", "bootstrap", "quote", "latest"]);
	});

	test("top-level verify still registers with the same option names", () => {
		const program = new Command();
		registerVerifyCommand(program);
		const verify = program.commands.find((c) => c.name() === "verify");
		expect(verify).toBeDefined();
		const optionNames = (verify?.options ?? []).map((o) => o.attributeName());
		expect(optionNames).toContain("against");
		expect(optionNames).toContain("quick");
		expect(optionNames).toContain("deep");
		expect(optionNames).toContain("json");
	});

	test("latest without an account key exits 1 with the SECONDLAYER_API_KEY hint", async () => {
		const { codes, restore } = captureExit();
		try {
			await expect(
				runLatest(
					{},
					{
						resolveAccountKey: () => undefined,
					},
				),
			).rejects.toThrow(/process\.exit:1/);
			expect(codes).toEqual([1]);
		} finally {
			restore();
		}
	});

	test("latest prints coverage, origin, and signature", async () => {
		await runLatest(
			{ json: true },
			{
				resolveAccountKey: () => "sk-sl_test",
				archive: () => ({
					latest: async () => loadedFixture,
					load: async () => loadedFixture,
					partitions: () => loadedFixture.manifest.partitions ?? [],
				}),
			},
		);
	});

	test("quote with insufficient balance exits 2", async () => {
		const { codes, restore } = captureExit();
		try {
			await expect(
				runQuote(
					{
						against: "https://archive.secondlayer.tools/snapshots/x.json",
						flow: "bootstrap",
						json: true,
					},
					{
						resolveAccountKey: () => "sk-sl_test",
						archive: () => ({
							latest: async () => loadedFixture,
							load: async () => loadedFixture,
							partitions: () => loadedFixture.manifest.partitions ?? [],
						}),
						quoteArchiveFetch: async () => ({
							ok: true,
							quote: {
								partitions: 1,
								bundles: 1,
								usdMicros: 5_000_000,
								usd: "5.00",
								freeAllowanceAppliedMicros: 0,
								allowanceRemainingBundles: 6,
								balanceUsdMicros: 1_000_000,
								sufficient: false,
							},
						}),
					},
				),
			).rejects.toThrow(/process\.exit:2/);
			expect(codes).toEqual([2]);
		} finally {
			restore();
		}
	});

	test("quote with an empty partition list exits 1", async () => {
		const { codes, restore } = captureExit();
		try {
			await expect(
				runQuote(
					{
						against: "https://archive.secondlayer.tools/snapshots/x.json",
						flow: "bootstrap",
					},
					{
						resolveAccountKey: () => "sk-sl_test",
						archive: () => ({
							latest: async () => loadedFixture,
							load: async () => loadedFixture,
							partitions: () => [],
						}),
					},
				),
			).rejects.toThrow(/process\.exit:1/);
			expect(codes).toEqual([1]);
		} finally {
			restore();
		}
	});
});

describe("secondlayer archive (spawn)", () => {
	test("archive latest without a key prints the SECONDLAYER_API_KEY hint", async () => {
		const home = await mkdtemp(join(tmpdir(), "sl-archive-cli-"));
		try {
			const proc = Bun.spawn(
				[
					process.execPath,
					"run",
					join(import.meta.dir, "../cli.ts"),
					"archive",
					"latest",
				],
				{
					cwd: join(import.meta.dir, "../.."),
					env: {
						...process.env,
						SECONDLAYER_API_KEY: "",
						SL_API_KEY: "",
						SL_ARCHIVE_API_KEY: "",
						INSTANCE_TOKEN: "",
						HOME: home,
					},
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
			expect(stdout + stderr).toMatch(/SECONDLAYER_API_KEY/);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
});
