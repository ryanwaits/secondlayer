import { afterEach, describe, expect, test } from "bun:test";
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
	program.hook("preAction", (thisCommand) => {
		const { network } = thisCommand.opts();
		if (network) process.env.STACKS_NETWORK = network;
	});
	return program;
}

const originalNetwork = process.env.STACKS_NETWORK;
afterEach(() => {
	if (originalNetwork === undefined) process.env.STACKS_NETWORK = undefined;
	else process.env.STACKS_NETWORK = originalNetwork;
});

describe("global --network reaches `init`, positioned after the subcommand", () => {
	test("secondlayer init --network testnet actually writes testnet, not the mainnet default", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-init-network-"));
		const cwd = process.cwd();
		process.chdir(dir);
		try {
			const program = buildProgram();
			registerInitCommand(program);
			program.parse(["node", "secondlayer", "init", "--network", "testnet"]);
			const body = readFileSync(join(dir, ".env.local"), "utf8");
			expect(body).toContain("STACKS_NETWORK=testnet");
			expect(body).not.toContain("STACKS_NETWORK=mainnet");
		} finally {
			process.chdir(cwd);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("no --network still defaults to mainnet", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-init-network-"));
		const cwd = process.cwd();
		process.chdir(dir);
		try {
			const program = buildProgram();
			registerInitCommand(program);
			program.parse(["node", "secondlayer", "init"]);
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
