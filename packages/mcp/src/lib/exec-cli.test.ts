import { describe, expect, it } from "bun:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { ExecCliError, assertSafeArgs, execSecondlayer } from "./exec-cli.ts";

function mockChild(result: {
	code: number;
	stdout?: string;
	stderr?: string;
	hang?: boolean;
}): ChildProcess {
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		stderr,
		pid: 4242,
		killed: false,
		kill() {
			child.killed = true;
			queueMicrotask(() => child.emit("close", 1));
			return true;
		},
	});
	if (!result.hang) {
		queueMicrotask(() => {
			if (result.stdout) stdout.emit("data", Buffer.from(result.stdout));
			if (result.stderr) stderr.emit("data", Buffer.from(result.stderr));
			child.emit("close", result.code);
		});
	}
	return child as unknown as ChildProcess;
}

describe("exec-cli argv safety", () => {
	it("rejects `; rm -rf /`", () => {
		expect(() => assertSafeArgs("bootstrap", ["; rm -rf /"])).toThrow(
			ExecCliError,
		);
		expect(() =>
			assertSafeArgs("bootstrap", ["--against", "; rm -rf /"]),
		).toThrow(/rejected argument/);
	});

	it("rejects NUL", () => {
		expect(() =>
			assertSafeArgs("bootstrap", ["--against", "foo\0bar"]),
		).toThrow(/rejected argument/);
	});

	it("rejects flags outside the subcommand allowlist", () => {
		expect(() => assertSafeArgs("setup", ["--json"])).toThrow(
			/flag not allowed/,
		);
		expect(() => assertSafeArgs("bootstrap", ["--apply"])).toThrow(
			/flag not allowed/,
		);
	});

	it("spawns an argv array, never a shell string", async () => {
		const calls: Array<{
			cmd: string;
			args: readonly string[];
			opts: SpawnOptions;
		}> = [];
		const result = await execSecondlayer(
			"bootstrap",
			["--against", "https://archive.secondlayer.tools/latest.json"],
			{
				spawn: (cmd, args, opts) => {
					calls.push({ cmd, args, opts });
					return mockChild({ code: 0, stdout: '{"ok":true}' });
				},
			},
		);
		expect(result.code).toBe(0);
		expect(calls).toHaveLength(1);
		expect(Array.isArray(calls[0]?.args)).toBe(true);
		expect(calls[0]?.args).toEqual([
			"bootstrap",
			"--against",
			"https://archive.secondlayer.tools/latest.json",
			"--json",
		]);
		expect(calls[0]?.opts.shell).toBe(false);
		expect(typeof calls[0]?.cmd).toBe("string");
		expect(calls[0]?.cmd).not.toContain("bootstrap --against");
	});

	it("uses SECONDLAYER_BIN and SECONDLAYER_CWD", async () => {
		const calls: Array<{ cmd: string; opts: SpawnOptions }> = [];
		await execSecondlayer(
			"verify",
			["--against", "https://example.test/m.json"],
			{
				env: {
					...process.env,
					SECONDLAYER_BIN: "/opt/secondlayer",
					SECONDLAYER_CWD: "/tmp/compose",
				},
				spawn: (cmd, _args, opts) => {
					calls.push({ cmd, opts });
					return mockChild({ code: 0, stdout: "{}" });
				},
			},
		);
		expect(calls[0]?.cmd).toBe("/opt/secondlayer");
		expect(calls[0]?.opts.cwd).toBe("/tmp/compose");
	});

	it("kills the process group on timeout", async () => {
		const result = await execSecondlayer(
			"verify",
			["--against", "https://example.test/m.json"],
			{
				timeoutMs: 20,
				spawn: () => mockChild({ code: 0, hang: true }),
			},
		);
		expect(result.code).toBe(124);
		expect(result.stderr).toContain("timeout");
	});
});
