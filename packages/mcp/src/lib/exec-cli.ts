import {
	type ChildProcess,
	type SpawnOptions,
	spawn,
} from "node:child_process";

export const ALLOWED = ["setup", "bootstrap", "repair", "verify"] as const;
export type Subcommand = (typeof ALLOWED)[number];

const TIMEOUT_MS: Record<Subcommand, number> = {
	setup: 15 * 60 * 1000,
	bootstrap: 10 * 60 * 1000,
	repair: 10 * 60 * 1000,
	verify: 2 * 60 * 1000,
};

const VALUE_FLAGS = new Set([
	"--against",
	"--from-block",
	"--to-block",
	"--network",
	"--node-mode",
	"--dir",
]);

const BOOL_FLAGS = new Set(["--yes", "--json", "--apply", "--skip-bootstrap"]);

export const FLAGS_BY_CMD: Record<Subcommand, ReadonlySet<string>> = {
	setup: new Set([
		"--yes",
		"--network",
		"--node-mode",
		"--against",
		"--dir",
		"--skip-bootstrap",
	]),
	bootstrap: new Set([
		"--against",
		"--yes",
		"--json",
		"--from-block",
		"--to-block",
	]),
	repair: new Set([
		"--against",
		"--json",
		"--apply",
		"--from-block",
		"--to-block",
		"--yes",
	]),
	verify: new Set(["--against", "--json", "--from-block", "--to-block"]),
};

export class ExecCliError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExecCliError";
	}
}

/** Reject NUL and argv that look like they start a new command. */
export function isUnsafeArg(arg: string): boolean {
	if (arg.includes("\0")) return true;
	if (/[\n\r]/.test(arg)) return true;
	return /^[;|&]/.test(arg.trim());
}

export function assertSafeArgs(subcommand: Subcommand, args: string[]): void {
	const allowed = FLAGS_BY_CMD[subcommand];
	let expectingValue: string | null = null;
	for (const arg of args) {
		if (isUnsafeArg(arg)) {
			throw new ExecCliError(`rejected argument: ${JSON.stringify(arg)}`);
		}
		if (expectingValue) {
			if (arg.startsWith("-")) {
				throw new ExecCliError(`${expectingValue} requires a value`);
			}
			expectingValue = null;
			continue;
		}
		if (!arg.startsWith("--") || !allowed.has(arg)) {
			throw new ExecCliError(
				`flag not allowed for ${subcommand}: ${JSON.stringify(arg)}`,
			);
		}
		if (VALUE_FLAGS.has(arg)) {
			expectingValue = arg;
		} else if (!BOOL_FLAGS.has(arg)) {
			throw new ExecCliError(
				`flag not allowed for ${subcommand}: ${JSON.stringify(arg)}`,
			);
		}
	}
	if (expectingValue) {
		throw new ExecCliError(`${expectingValue} requires a value`);
	}
}

export type SpawnImpl = (
	command: string,
	args: readonly string[],
	options: SpawnOptions,
) => ChildProcess;

export type ExecResult = { code: number; stdout: string; stderr: string };

export type ExecDeps = {
	spawn?: SpawnImpl;
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	timeoutMs?: number;
};

function killProcessGroup(child: ChildProcess): void {
	const pid = child.pid;
	if (pid && process.platform !== "win32") {
		try {
			process.kill(-pid, "SIGKILL");
			return;
		} catch {
			// mocked pid or already exited
		}
	}
	child.kill("SIGKILL");
}

/**
 * Run `secondlayer <subcommand> …` as an argv array. Never `sh -c`.
 * Binary is `SECONDLAYER_BIN` or `secondlayer` on PATH — do not set `shell`.
 */
export async function execSecondlayer(
	subcommand: Subcommand,
	args: string[],
	deps: ExecDeps = {},
): Promise<ExecResult> {
	if (!(ALLOWED as readonly string[]).includes(subcommand)) {
		throw new ExecCliError(`subcommand not allowed: ${subcommand}`);
	}
	assertSafeArgs(subcommand, args);

	const argv = [subcommand, ...args];
	if (subcommand === "setup") {
		if (!argv.includes("--yes")) argv.push("--yes");
	} else if (!argv.includes("--json")) {
		argv.push("--json");
	}

	const env = deps.env ?? process.env;
	const bin = env.SECONDLAYER_BIN || "secondlayer";
	const cwd = deps.cwd ?? env.SECONDLAYER_CWD ?? process.cwd();
	const spawnFn = deps.spawn ?? spawn;
	const timeout = deps.timeoutMs ?? TIMEOUT_MS[subcommand];

	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let settled = false;

		const child = spawnFn(bin, argv, {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
			shell: false,
		});

		const timer = setTimeout(() => {
			killProcessGroup(child);
			finish({
				code: 124,
				stdout,
				stderr: `${stderr}\ntimeout after ${timeout}ms`.trim(),
			});
		}, timeout);

		function finish(result: ExecResult) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		}

		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdout += String(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr += String(chunk);
		});
		child.on("error", (err) => {
			finish({ code: 127, stdout, stderr: err.message });
		});
		child.on("close", (code) => {
			finish({ code: code ?? 1, stdout, stderr });
		});
	});
}
