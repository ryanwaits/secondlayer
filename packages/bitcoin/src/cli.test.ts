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
import postgres from "postgres";
import { databaseNameFromUrl, migrateToLatest } from "./db/migrate.ts";

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

// Plan 084: `follow` (no `--until`) only stops on SIGINT/SIGTERM, and before
// this plan a SIGTERM while parked in `RpcWaitNotifier.notified()` waited out
// bitcoind's own `waitfornewblock` timeout (up to 30s) — Docker's default
// 10s grace period SIGKILLs it first (exit 137), every single stop. This
// spawns the real CLI entrypoint (not `runFollow` in-process) against a fake
// bitcoind so the whole path — `process.once("SIGTERM", ...)` in `cli.ts`,
// `controller.abort()` + `notifier.close()`, `RpcWaitNotifier` cancelling its
// in-flight `waitfornewblock` — is exercised exactly as `docker stop` does it.
describe.skipIf(!testUrl)("follow stops promptly on SIGTERM", () => {
	/** A scratch DB distinct from the one the suite above shares — this test needs a brand-new, empty DB (no prior checkpoint) so `follow`'s first pass has nothing to catch up on and goes straight to parking in `notified()`. */
	function uniqueFollowTestUrl(baseUrl: string): string {
		const url = new URL(baseUrl);
		url.pathname = `/bitcoin_follow_sigterm_${Date.now()}`;
		return url.toString();
	}

	async function dropDatabase(url: string): Promise<void> {
		const adminUrl = new URL(url);
		adminUrl.pathname = "/postgres";
		const admin = postgres(adminUrl.toString(), { max: 1 });
		try {
			await admin.unsafe(
				`DROP DATABASE IF EXISTS "${databaseNameFromUrl(url)}"`,
			);
		} finally {
			await admin.end();
		}
	}

	/**
	 * A fake bitcoind JSON-RPC endpoint — just enough for `follow` on a
	 * brand-new DB to see nothing to catch up on (`getblockcount` always
	 * answers the same height as `BITCOIN_GENESIS_HEIGHT - 1`) and then park
	 * in `waitfornewblock`, which never answers on its own (only the client's
	 * own `close()`-triggered abort ends the request — proving cancellation,
	 * not a lucky response). `parked` resolves the moment that request lands,
	 * so the test knows to send SIGTERM only once `follow` is actually parked.
	 */
	function startFakeBitcoind(): {
		url: string;
		parked: Promise<void>;
		stop: () => void;
	} {
		let resolveParked: () => void = () => {};
		const parked = new Promise<void>((resolve) => {
			resolveParked = resolve;
		});
		const server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: async (req) => {
				const body = (await req.json()) as { method: string; id: unknown };
				if (body.method === "getblockcount") {
					return Response.json({ result: 100, error: null, id: body.id });
				}
				if (body.method === "waitfornewblock") {
					resolveParked();
					return new Promise<Response>(() => {}); // never settles on its own
				}
				return Response.json({
					result: null,
					error: { code: -32601, message: `unexpected method ${body.method}` },
					id: body.id,
				});
			},
		});
		return {
			url: `http://127.0.0.1:${server.port}`,
			parked,
			stop: () => server.stop(true),
		};
	}

	test("exits 0 within 5s of SIGTERM while parked in waitfornewblock", async () => {
		// biome-ignore lint/style/noNonNullAssertion: describe.skipIf(!testUrl) guards this whole block
		const followUrl = uniqueFollowTestUrl(testUrl!);
		process.env.BITCOIN_DATABASE_URL = followUrl;
		await migrateToLatest();

		const fakeRpc = startFakeBitcoind();
		let exitCode: number;
		try {
			const proc = Bun.spawn(["bun", "run", "src/cli.ts", "follow"], {
				cwd: packageRoot,
				env: {
					...process.env,
					BITCOIN_DATABASE_URL: followUrl,
					BITCOIN_RPC_URL: fakeRpc.url,
					BITCOIN_RPC_USERNAME: "test",
					BITCOIN_RPC_PASSWORD: "test",
					BITCOIN_NETWORK: "regtest",
					// checkpointHeight = GENESIS_HEIGHT - 1 = 100 = the fake tip
					// (getblockcount), so there's nothing to catch up on.
					BITCOIN_GENESIS_HEIGHT: "101",
				},
				stdout: "pipe",
				stderr: "pipe",
			});

			try {
				await Promise.race([
					fakeRpc.parked,
					new Promise((_resolve, reject) =>
						setTimeout(
							() =>
								reject(
									new Error("follow never reached waitfornewblock within 5s"),
								),
							5_000,
						),
					),
				]);

				proc.kill("SIGTERM");

				exitCode = await Promise.race([
					proc.exited,
					new Promise<number>((_resolve, reject) =>
						setTimeout(
							() =>
								reject(new Error("follow did not exit within 5s of SIGTERM")),
							5_000,
						),
					),
				]);
			} catch (error) {
				proc.kill();
				throw error;
			}
		} finally {
			fakeRpc.stop();
		}

		expect(exitCode).toBe(0);

		await dropDatabase(followUrl);
	}, 15_000);
});
