import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildSubscriptionAuthConfig,
	parseTriggersInput,
	resolveRuntime,
} from "../src/commands/create.ts";

describe("create subscription tenant resolution", () => {
	it("builds bearer auth config from --auth-token", () => {
		expect(buildSubscriptionAuthConfig(" tr_secret_abc ")).toEqual({
			authType: "bearer",
			token: "tr_secret_abc",
		});
		expect(buildSubscriptionAuthConfig()).toBeUndefined();
		expect(() => buildSubscriptionAuthConfig("   ")).toThrow(
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

describe("subscriptions create picks a runtime without a menu once flags are given", () => {
	it("an explicit --runtime always wins", () => {
		expect(resolveRuntime({ runtime: "inngest", subgraph: "g" })).toBe(
			"inngest",
		);
	});

	it("any of -s/-t/-u or --no-scaffold defaults the runtime to node", () => {
		expect(resolveRuntime({ subgraph: "g" })).toBe("node");
		expect(resolveRuntime({ table: "t" })).toBe("node");
		expect(resolveRuntime({ url: "https://x.example/hook" })).toBe("node");
		expect(resolveRuntime({ scaffold: false })).toBe("node");
	});

	it("no flags at all leaves the runtime to the interactive menu", () => {
		expect(resolveRuntime({})).toBeUndefined();
		expect(resolveRuntime({ scaffold: true })).toBeUndefined();
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
			"subscriptions",
			"create",
			...args,
		],
		{
			cwd,
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
	return { exitCode, printed: stdout + stderr };
}

describe("subscriptions create without a TTY", () => {
	it("the documented flags-only example scaffolds a node receiver and exits 0, no menu", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-create-notty-"));
		try {
			const { exitCode, printed } = await runCreate(
				[
					"my-sub",
					"-s",
					"my-graph",
					"-t",
					"transfers",
					"-u",
					"https://example.com/webhook",
					"--skip-api",
				],
				dir,
			);
			expect(printed).not.toMatch(/Runtime\?/);
			expect(printed).toMatch(/Scaffolding node template/);
			expect(existsSync(join(dir, "my-sub", "package.json"))).toBe(true);
			expect(exitCode).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30_000);

	it("with no flags it exits 1 naming --runtime instead of exiting 0 having created nothing", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-create-notty-bare-"));
		try {
			const { exitCode, printed } = await runCreate(["my-sub"], dir);
			expect(exitCode).toBe(1);
			expect(printed).toMatch(/--runtime is required when stdin is not a TTY/);
			expect(existsSync(join(dir, "my-sub"))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30_000);
});
