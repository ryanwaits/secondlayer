import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildWebhookAuthConfig,
	parseTriggersInput,
} from "../src/commands/create.ts";

describe("create subscription tenant resolution", () => {
	it("builds bearer auth config from --auth-token", () => {
		expect(buildWebhookAuthConfig(" tr_secret_abc ")).toEqual({
			authType: "bearer",
			token: "tr_secret_abc",
		});
		expect(buildWebhookAuthConfig()).toBeUndefined();
		expect(() => buildWebhookAuthConfig("   ")).toThrow(
			"--auth-token must not be empty",
		);
	});
});

describe("parseTriggersInput", () => {
	it("parses repeatable inline --trigger JSON into validated triggers", () => {
		const triggers = parseTriggersInput({
			trigger: ['{"type":"sbtc_deposit"}', '{"type":"contract_call"}'],
		});
		expect(triggers).toEqual([
			{ type: "sbtc_deposit" },
			{ type: "contract_call" },
		]);
	});

	it("parses a --triggers-file JSON array", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-triggers-"));
		const file = join(dir, "triggers.json");
		writeFileSync(file, JSON.stringify([{ type: "sbtc_withdrawal_accept" }]));
		expect(parseTriggersInput({ triggersFile: file })).toEqual([
			{ type: "sbtc_withdrawal_accept" },
		]);
	});

	it("merges file and inline triggers", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-triggers-"));
		const file = join(dir, "triggers.json");
		writeFileSync(file, JSON.stringify([{ type: "sbtc_deposit" }]));
		expect(
			parseTriggersInput({
				triggersFile: file,
				trigger: ['{"type":"stx_transfer"}'],
			}),
		).toEqual([{ type: "sbtc_deposit" }, { type: "stx_transfer" }]);
	});

	it("throws on invalid JSON", () => {
		expect(() => parseTriggersInput({ trigger: ["{not json}"] })).toThrow(
			/not valid JSON/,
		);
	});

	it("throws on an unknown trigger type", () => {
		expect(() => parseTriggersInput({ trigger: ['{"type":"nope"}'] })).toThrow(
			/Invalid trigger at index 0/,
		);
	});

	it("throws when no triggers are provided", () => {
		expect(() => parseTriggersInput({})).toThrow(/at least one --trigger/);
	});

	it("throws when --triggers-file is not a JSON array", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-triggers-"));
		const file = join(dir, "bad.json");
		writeFileSync(file, JSON.stringify({ type: "sbtc_deposit" }));
		expect(() => parseTriggersInput({ triggersFile: file })).toThrow(
			/must contain a JSON array/,
		);
	});
});

async function runCreate(
	args: string[],
	cwd: string,
): Promise<{ exitCode: number; printed: string }> {
	const proc = Bun.spawn(
		[
			process.execPath,
			"run",
			join(import.meta.dir, "../src/cli.ts"),
			"webhooks",
			"create",
			...args,
		],
		{
			cwd,
			env: { ...process.env, SECONDLAYER_API_URL: "http://127.0.0.1:1" },
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
	return { exitCode, printed: stdout + stderr };
}

describe("webhooks create validates its flags before any network call", () => {
	it("without --url it exits 1 naming --url", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-create-no-url-"));
		try {
			const { exitCode, printed } = await runCreate(["my-hook"], dir);
			expect(exitCode).toBe(1);
			expect(printed).toMatch(/--url is required/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30_000);

	it("with --url but no trigger it exits 1 asking for one", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-create-no-trigger-"));
		try {
			const { exitCode, printed } = await runCreate(
				["my-hook", "-u", "https://example.com/webhook"],
				dir,
			);
			expect(exitCode).toBe(1);
			expect(printed).toMatch(/at least one --trigger/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30_000);

	it("the removed subgraph and scaffold flags are unknown options", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-create-removed-flags-"));
		try {
			for (const flag of ["--subgraph", "--table", "--runtime", "--filter"]) {
				const { exitCode, printed } = await runCreate(
					["my-hook", flag, "x"],
					dir,
				);
				expect(exitCode).toBe(1);
				expect(printed).toMatch(/unknown option/);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30_000);
});
