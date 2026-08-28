import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerInitCommand } from "./init.ts";
import { registerObserverCommand } from "./observer.ts";

/**
 * Regression coverage for a real Commander bug: `cli.ts` registers a global
 * `--network <network>` on `program`, and `init`/`observer` used to also
 * declare their own local `--network` option. When both a parent and a child
 * command declare the same flag, Commander resolves a value passed *after*
 * the subcommand name onto the ancestor's `opts()`, not the subcommand's —
 * so `secondlayer init --network testnet` silently ignored `testnet` and
 * fell through to the subcommand's own hardcoded default every time. These
 * tests build the exact same two-level shape `cli.ts` does (global option +
 * `preAction` hook writing STACKS_NETWORK) so a regression here reproduces
 * the actual bug, not just a unit test of `parseInstanceNetwork`.
 */

function buildProgram(): Command {
	const program = new Command();
	program.exitOverride(); // throw instead of process.exit on parse errors
	program.option("--network <network>", "Override network");
	program.option("--api-url <url>", "API endpoint");
	program.hook("preAction", (thisCommand) => {
		const { network, apiUrl } = thisCommand.opts();
		if (network) process.env.STACKS_NETWORK = network;
		if (apiUrl) process.env.SL_API_URL = apiUrl;
	});
	return program;
}

const originalNetwork = process.env.STACKS_NETWORK;
const originalApiUrl = process.env.SL_API_URL;
afterEach(() => {
	if (originalNetwork === undefined) process.env.STACKS_NETWORK = undefined;
	else process.env.STACKS_NETWORK = originalNetwork;
	if (originalApiUrl === undefined) process.env.SL_API_URL = undefined;
	else process.env.SL_API_URL = originalApiUrl;
});

const CLI_ENTRY = join(import.meta.dir, "../cli.ts");

describe("global --network reaches `init`, positioned after the subcommand", () => {
	test("secondlayer init --network testnet actually writes testnet, not the mainnet default", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-init-network-"));
		const cwd = process.cwd();
		process.chdir(dir);
		try {
			const program = buildProgram();
			registerInitCommand(program);
			await program.parseAsync([
				"node",
				"secondlayer",
				"init",
				"--network",
				"testnet",
			]);
			const body = readFileSync(join(dir, ".env.local"), "utf8");
			expect(body).toContain("STACKS_NETWORK=testnet");
			expect(body).not.toContain("STACKS_NETWORK=mainnet");
		} finally {
			process.chdir(cwd);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("secondlayer init --api-url writes that URL as SL_API_URL instead of the loopback default", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-init-api-url-"));
		const cwd = process.cwd();
		process.chdir(dir);
		try {
			const program = buildProgram();
			registerInitCommand(program);
			await program.parseAsync([
				"node",
				"secondlayer",
				"init",
				"--api-url",
				"http://10.0.0.7:3800",
			]);
			const body = readFileSync(join(dir, ".env.local"), "utf8");
			expect(body).toContain("SL_API_URL=http://10.0.0.7:3800");
			expect(body).not.toContain("SL_API_URL=http://127.0.0.1:3800");
		} finally {
			process.chdir(cwd);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("secondlayer init --network local exits 1 with a one-line error, not a stack trace", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-init-bad-network-"));
		try {
			const res = spawnSync(
				process.execPath,
				[CLI_ENTRY, "init", "--network", "local"],
				{
					cwd: dir,
					encoding: "utf8",
					// A set DATABASE_URL keeps the shared db module's test-time
					// "unset" warning off stderr; init never connects to it.
					env: {
						...process.env,
						NO_COLOR: "1",
						DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
					},
				},
			);
			expect(res.status).toBe(1);
			expect(res.stderr.trim().split("\n")[0]).toContain(
				"mainnet, testnet, or devnet",
			);
			expect(res.stderr).not.toMatch(/^\s+at /m);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("no --network still defaults to mainnet", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-init-network-"));
		const cwd = process.cwd();
		process.chdir(dir);
		try {
			const program = buildProgram();
			registerInitCommand(program);
			await program.parseAsync(["node", "secondlayer", "init"]);
			const body = readFileSync(join(dir, ".env.local"), "utf8");
			expect(body).toContain("STACKS_NETWORK=mainnet");
		} finally {
			process.chdir(cwd);
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("global --network reaches `observer`, positioned after the subcommand", () => {
	function captureStdout(run: () => void): string {
		const original = process.stdout.write.bind(process.stdout);
		let out = "";
		// biome-ignore lint/suspicious/noExplicitAny: matching Node's writable signature
		(process.stdout.write as any) = (chunk: any) => {
			out += chunk.toString();
			return true;
		};
		try {
			run();
		} finally {
			process.stdout.write = original;
		}
		return out;
	}

	test("secondlayer observer --network devnet picks devnet's loopback default, not mainnet's", () => {
		const program = buildProgram();
		registerObserverCommand(program);
		const out = captureStdout(() => {
			program.parse(["node", "secondlayer", "observer", "--network", "devnet"]);
		});
		expect(out).toContain('endpoint = "127.0.0.1:3700"');
		expect(out).not.toContain('endpoint = "indexer:3700"');
	});

	test("no --network still defaults to mainnet's indexer:3700", () => {
		const program = buildProgram();
		registerObserverCommand(program);
		const out = captureStdout(() => {
			program.parse(["node", "secondlayer", "observer"]);
		});
		expect(out).toContain('endpoint = "indexer:3700"');
	});
});
