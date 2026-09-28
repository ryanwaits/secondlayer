// Plan 081: `cli.ts`'s one-shot commands (everything but `follow`) must exit
// the process once they finish instead of leaving it alive — observed on the
// feeder as `migrate`/`backfill` containers still "Up" hours after their
// success line printed. Spawns the CLI as a real child process and asserts
// it exits 0 within a bounded deadline; a regression here hangs the test
// itself until the deadline kills it, rather than passing silently.
//
// Skipped when BITCOIN_TEST_DATABASE_URL isn't set (same convention as
// follow.test.ts/rewind.test.ts):
//
//   BITCOIN_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5440/bitcoin_cli_test \
//     bun test src/cli.test.ts
import { beforeAll, describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateToLatest } from "./db/migrate.ts";

const testUrl = process.env.BITCOIN_TEST_DATABASE_URL;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Comfortably above the 30s the plan requires, so a real hang always kills the child and fails loudly instead of racing bun test's own per-test timeout. */
const SPAWN_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 35_000;

async function runCli(
	args: string[],
	env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
		cwd: packageRoot,
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, SPAWN_TIMEOUT_MS);

	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (timedOut) {
			throw new Error(
				`cli ${args.join(" ")} did not exit within ${SPAWN_TIMEOUT_MS}ms (killed) — stdout:\n${stdout}\nstderr:\n${stderr}`,
			);
		}
		return { exitCode, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}

describe.skipIf(!testUrl)("cli one-shot commands exit", () => {
	beforeAll(async () => {
		// migrateToLatest() reads BITCOIN_DATABASE_URL from process.env directly
		// (db/migrate.ts), not a parameter — set it before calling in-process so
		// both commands below run against an already-migrated scratch DB.
		process.env.BITCOIN_DATABASE_URL = testUrl;
		await migrateToLatest();
	});

	// biome-ignore lint/style/noNonNullAssertion: describe.skipIf(!testUrl) guards this whole block
	const dbEnv = { BITCOIN_DATABASE_URL: testUrl! };

	test(
		"migrate exits 0 within 30s",
		async () => {
			const result = await runCli(["migrate"], dbEnv);
			expect(result.exitCode).toBe(0);
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"state-hash exits 0 on an empty migrated DB within 30s",
		async () => {
			const result = await runCli(["state-hash"], dbEnv);
			expect(result.exitCode).toBe(0);
		},
		TEST_TIMEOUT_MS,
	);
});
