import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SetupEvent } from "./setup-wizard.ts";
import {
	DEFAULT_ARCHIVE_MANIFEST,
	MissingSetupFlagError,
	buildChildEnv,
	buildSuccessSummary,
	checkDatabaseReachable,
	composeProfileArgs,
	guardrailPreview,
	isBunRuntime,
	preflightBootstrapDatabase,
	redactUrl,
	resolveAvailablePublishSpec,
	resolveNonInteractiveConfig,
	resolveSecrets,
	runStreaming,
	setupDatabaseUrl,
	writeSetupFiles,
} from "./setup-wizard.ts";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "sl-setup-"));
}

describe("isBunRuntime", () => {
	test("true under bun (this test file's own runtime)", () => {
		expect(isBunRuntime()).toBe(true);
	});

	test("false under node — the exact case OpenTUI can't initialize in", () => {
		// This is the regression this function exists to catch: the published
		// CLI runs under node via its shebang, and OpenTUI's native FFI loader
		// throws there. Spawn a real node process to prove the check agrees.
		const src = `
			const v = process.versions;
			const isBun = typeof v === "object" && v !== null && typeof v.bun === "string";
			process.stdout.write(String(isBun));
		`;
		const result = spawnSync("node", ["-e", src]);
		expect(result.stdout?.toString()).toBe("false");
	});
});

describe("resolveNonInteractiveConfig — flag validation", () => {
	test("fails fast naming --network when it's missing", () => {
		expect(() =>
			resolveNonInteractiveConfig({ nodeMode: "external", against: "x" }),
		).toThrow(MissingSetupFlagError);
		try {
			resolveNonInteractiveConfig({ nodeMode: "external", against: "x" });
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(MissingSetupFlagError);
			expect((err as MissingSetupFlagError).flag).toBe("--network");
		}
	});

	test("fails fast naming --node-mode when it's missing", () => {
		try {
			resolveNonInteractiveConfig({ network: "mainnet", against: "x" });
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(MissingSetupFlagError);
			expect((err as MissingSetupFlagError).flag).toBe("--node-mode");
		}
	});

	test("fails fast naming --against when bootstrap isn't skipped", () => {
		try {
			resolveNonInteractiveConfig({ network: "mainnet", nodeMode: "external" });
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(MissingSetupFlagError);
			expect((err as MissingSetupFlagError).flag).toBe("--against");
		}
	});

	test("--skip-bootstrap makes --against optional", () => {
		const config = resolveNonInteractiveConfig({
			network: "mainnet",
			nodeMode: "external",
			skipBootstrap: true,
		});
		expect(config.skipBootstrap).toBe(true);
		expect(config.against).toBeUndefined();
	});

	test("rejects an unknown network or node mode with a clear error, not a silent default", () => {
		expect(() =>
			resolveNonInteractiveConfig({
				network: "regtest",
				nodeMode: "external",
				skipBootstrap: true,
			}),
		).toThrow(/mainnet/);
		expect(() =>
			resolveNonInteractiveConfig({
				network: "mainnet",
				nodeMode: "docker",
				skipBootstrap: true,
			}),
		).toThrow(/external/);
	});

	test("resolves a full config from flags with sane defaults", () => {
		const config = resolveNonInteractiveConfig({
			network: "testnet",
			nodeMode: "full",
			against: DEFAULT_ARCHIVE_MANIFEST,
			dir: "/tmp/example",
		});
		expect(config.network).toBe("testnet");
		expect(config.nodeMode).toBe("full");
		expect(config.against).toBe(DEFAULT_ARCHIVE_MANIFEST);
		expect(config.apiPort).toBe("127.0.0.1:3800");
		expect(config.dir).toBe("/tmp/example");
	});
});

describe("guardrailPreview", () => {
	test("full node mode needs far more RAM than the app-only modes", () => {
		const external = guardrailPreview("external", "mainnet");
		const full = guardrailPreview("full", "mainnet");
		expect(full.ramFloorMb).toBeGreaterThan(external.ramFloorMb);
		expect(full.diskFloorGb).toBeGreaterThan(external.diskFloorGb);
	});

	test("mainnet's disk floor is larger than testnet/devnet for the same mode", () => {
		const mainnet = guardrailPreview("external", "mainnet");
		const testnet = guardrailPreview("external", "testnet");
		expect(mainnet.diskFloorGb).toBeGreaterThan(testnet.diskFloorGb);
	});
});

describe("composeProfileArgs", () => {
	test("external adds no profile flag", () => {
		expect(composeProfileArgs("external")).toEqual([]);
	});
	test("stacks also adds no profile flag — no bundled-stacks-only profile exists", () => {
		// There is nothing to wire a bundled stacks-node's Bitcoin data from
		// without also bundling bitcoind, so `stacks` behaves like `external`
		// at the compose level: bring your own node.
		expect(composeProfileArgs("stacks")).toEqual([]);
	});
	test("full adds its bundled-node (stacks-node + bitcoind) profile", () => {
		expect(composeProfileArgs("full")).toEqual(["--profile", "full-node"]);
	});
});

describe("resolveAvailablePublishSpec — port-collision routing", () => {
	// Reproduces the real bug: `docker compose up` failing opaquely with
	// "Bind for 127.0.0.1:5432 failed: port is already allocated" because a
	// local (non-Docker) Postgres was already listening there. This binds a
	// real listener on a real port first, then asserts setup routes around
	// it rather than handing that same busy port to docker compose.
	function listenOnFreePort(): Promise<{
		port: number;
		close: () => Promise<void>;
	}> {
		return new Promise((resolvePromise, reject) => {
			const srv = createServer();
			srv.once("error", reject);
			srv.listen(0, "127.0.0.1", () => {
				const address = srv.address();
				if (address === null || typeof address === "string") {
					reject(new Error("expected a bound TCP address"));
					return;
				}
				resolvePromise({
					port: address.port,
					close: () => new Promise((res) => srv.close(() => res())),
				});
			});
		});
	}

	test("a busy port is remapped to the next free one", async () => {
		const busy = await listenOnFreePort();
		try {
			const result = await resolveAvailablePublishSpec(
				`127.0.0.1:${busy.port}`,
			);
			expect(result.remapped).toBe(true);
			expect(result.spec).not.toBe(`127.0.0.1:${busy.port}`);
			expect(result.spec.startsWith("127.0.0.1:")).toBe(true);
		} finally {
			await busy.close();
		}
	});

	test("a free port is left exactly as requested", async () => {
		const free = await listenOnFreePort();
		const port = free.port;
		await free.close();

		const result = await resolveAvailablePublishSpec(`127.0.0.1:${port}`);
		expect(result).toEqual({ spec: `127.0.0.1:${port}`, remapped: false });
	});

	test("skips a port Docker already published even though a raw bind to it succeeds", async () => {
		// Reproduces a second, subtler real failure found while smoke-testing
		// the fix above on a box with other docker-compose stacks running:
		// Docker's own NAT allocator refuses to publish a port on 127.0.0.1 if
		// another container already holds it on 0.0.0.0, but a bare OS socket
		// bind to 127.0.0.1 still succeeds there (BSD allows a specific-address
		// bind alongside an existing wildcard one) — so `isPortFree` alone
		// reported the port free right before `docker compose up` failed on it
		// for real. `claimedByDocker` is the fix: it's consulted independently
		// of the OS-level bind check.
		const free = await listenOnFreePort();
		const port = free.port;
		await free.close();
		// `port` really is free at the OS level (just closed above) — the only
		// reason it should be skipped is that it's in `claimedByDocker`.
		const claimedByDocker = new Set([port]);

		const result = await resolveAvailablePublishSpec(
			`127.0.0.1:${port}`,
			claimedByDocker,
		);
		expect(result.remapped).toBe(true);
		expect(result.spec).not.toBe(`127.0.0.1:${port}`);
	});
});

describe("resolveSecrets — idempotency", () => {
	test("re-running without --force reuses the token, secrets key, and passwords", () => {
		const dir = tmpDir();
		const first = resolveSecrets({
			dir,
			network: "mainnet",
			apiPort: "127.0.0.1:3800",
			force: false,
		});
		expect(first.instance.INSTANCE_TOKEN).toHaveLength(64);

		// Nothing written to disk yet — resolveSecrets only reads. Simulate the
		// same round-trip writeSetupFiles would do so a second resolve sees it.
		const config = resolveNonInteractiveConfig({
			network: "mainnet",
			nodeMode: "external",
			skipBootstrap: true,
			dir,
		});

		return writeSetupFiles(config, first).then(() => {
			const second = resolveSecrets({
				dir,
				network: "mainnet",
				apiPort: "127.0.0.1:3800",
				force: false,
			});
			expect(second.instance.INSTANCE_TOKEN).toBe(
				first.instance.INSTANCE_TOKEN,
			);
			expect(second.instance.SECONDLAYER_SECRETS_KEY).toBe(
				first.instance.SECONDLAYER_SECRETS_KEY,
			);
			expect(second.postgresPassword).toBe(first.postgresPassword);

			const forced = resolveSecrets({
				dir,
				network: "mainnet",
				apiPort: "127.0.0.1:3800",
				force: true,
			});
			expect(forced.instance.INSTANCE_TOKEN).not.toBe(
				first.instance.INSTANCE_TOKEN,
			);
			expect(forced.postgresPassword).not.toBe(first.postgresPassword);
		});
	});
});

describe("writeSetupFiles", () => {
	test("writes a compose file and .env with no secrets baked into the compose file", async () => {
		const dir = tmpDir();
		const config = resolveNonInteractiveConfig({
			network: "mainnet",
			nodeMode: "external",
			skipBootstrap: true,
			dir,
		});
		const secrets = resolveSecrets({
			dir,
			network: config.network,
			apiPort: config.apiPort,
			force: false,
		});
		const files = await writeSetupFiles(config, secrets);

		const compose = readFileSync(files.composePath, "utf8");
		expect(compose).toContain("ghcr.io/");
		expect(compose).toContain("secondlayer-runtime");
		expect(compose).not.toContain(secrets.instance.INSTANCE_TOKEN);
		expect(compose).toContain("${INSTANCE_TOKEN:-}");

		const env = readFileSync(files.envPath, "utf8");
		expect(env).toContain(`INSTANCE_TOKEN=${secrets.instance.INSTANCE_TOKEN}`);
		expect(env).toContain("NETWORK=mainnet");
		expect(env).toContain("NODE_MODE=external");
		expect(files.configTomlPath).toBeUndefined();
	});

	test("stacks mode writes no bundled-node files — no compose profile mounts them", async () => {
		// `stacks` behaves like `external` at the compose level (see
		// composeProfileArgs): no profile bundles a stacks-node for it, so
		// writing a Config.toml nothing will ever read would be dead output.
		const dir = tmpDir();
		const stacksConfig = resolveNonInteractiveConfig({
			network: "mainnet",
			nodeMode: "stacks",
			skipBootstrap: true,
			dir,
		});
		const stacksSecrets = resolveSecrets({
			dir,
			network: stacksConfig.network,
			apiPort: stacksConfig.apiPort,
			force: false,
		});
		const stacksFiles = await writeSetupFiles(stacksConfig, stacksSecrets);
		expect(stacksFiles.configTomlPath).toBeUndefined();
		expect(stacksFiles.bitcoinConfPath).toBeUndefined();
	});

	test("full mode writes both Config.toml and bitcoin.conf", async () => {
		const fullDir = tmpDir();
		const fullConfig = resolveNonInteractiveConfig({
			network: "mainnet",
			nodeMode: "full",
			skipBootstrap: true,
			dir: fullDir,
		});
		const fullSecrets = resolveSecrets({
			dir: fullDir,
			network: fullConfig.network,
			apiPort: fullConfig.apiPort,
			force: false,
		});
		const fullFiles = await writeSetupFiles(fullConfig, fullSecrets);
		expect(fullFiles.configTomlPath).toBeDefined();
		expect(fullFiles.bitcoinConfPath).toBeDefined();
	});
});

describe("generated .env carries the database the compose Postgres actually runs", () => {
	async function setupDir(postgresPort = "127.0.0.1:5432") {
		const dir = tmpDir();
		const config = {
			...resolveNonInteractiveConfig({
				network: "mainnet",
				nodeMode: "external",
				skipBootstrap: true,
				dir,
			}),
			postgresPort,
		};
		const secrets = resolveSecrets({
			dir,
			network: config.network,
			apiPort: config.apiPort,
			force: false,
		});
		const files = await writeSetupFiles(config, secrets);
		return { dir, config, secrets, files };
	}

	test(".env DATABASE_URL points at POSTGRES_USER/PASSWORD/PORT/DB from the same file", async () => {
		const { config, secrets, files } = await setupDir("127.0.0.1:5433");
		const env = readFileSync(files.envPath, "utf8");
		const url = setupDatabaseUrl(config, secrets);
		expect(url).toBe(
			`postgres://secondlayer:${secrets.postgresPassword}@127.0.0.1:5433/secondlayer`,
		);
		expect(env).toContain(`DATABASE_URL=${url}`);
		expect(env).toContain("POSTGRES_PORT=127.0.0.1:5433");
	});

	test("a DATABASE_URL the operator edited survives a re-run", async () => {
		const { dir, config, files } = await setupDir();
		const edited = "postgres://ops:pw@db.internal:5432/index";
		writeFileSync(
			files.envPath,
			readFileSync(files.envPath, "utf8").replace(
				/^DATABASE_URL=.*$/m,
				`DATABASE_URL=${edited}`,
			),
		);
		const again = resolveSecrets({
			dir,
			network: config.network,
			apiPort: config.apiPort,
			force: false,
		});
		expect(again.databaseUrl).toBe(edited);
		expect(setupDatabaseUrl(config, again)).toBe(edited);
		await writeSetupFiles(config, again);
		expect(readFileSync(files.envPath, "utf8")).toContain(
			`DATABASE_URL=${edited}`,
		);
	});

	test("a generated DATABASE_URL follows the Postgres port a re-run binds", async () => {
		// The first run's Postgres still holds 5432 on a re-run, so preflight
		// remaps to 5433. Keeping the old URL would point bootstrap at
		// whatever else answers on 5432 (a shared dev Postgres) instead of
		// the compose Postgres that just came up on 5433.
		const { dir, config, secrets, files } = await setupDir("127.0.0.1:5432");
		const remapped = { ...config, postgresPort: "127.0.0.1:5433" };
		const again = resolveSecrets({
			dir,
			network: config.network,
			apiPort: config.apiPort,
			force: false,
		});
		expect(again.databaseUrl).toBeUndefined();
		expect(again.postgresPassword).toBe(secrets.postgresPassword);
		const url = setupDatabaseUrl(remapped, again);
		expect(url).toBe(
			`postgres://secondlayer:${secrets.postgresPassword}@127.0.0.1:5433/secondlayer`,
		);
		await writeSetupFiles(remapped, again);
		const env = readFileSync(files.envPath, "utf8");
		expect(env).toContain("POSTGRES_PORT=127.0.0.1:5433");
		expect(env).toContain(`DATABASE_URL=${url}`);
	});

	test("SELECT 1 against a Postgres that is not answering fails with the connection error", async () => {
		const result = await checkDatabaseReachable(
			"postgres://secondlayer:pw@127.0.0.1:1/secondlayer",
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error.length).toBeGreaterThan(0);
	});

	test("bootstrap is refused with a step-error, password redacted, when its database does not answer", async () => {
		const events: SetupEvent[] = [];
		const url = await preflightBootstrapDatabase(
			{ postgresPort: "127.0.0.1:1" },
			{ postgresPassword: "s3cret" },
			(event) => events.push(event),
		);
		expect(url).toBeNull();
		expect(events).toHaveLength(1);
		const [event] = events;
		expect(event?.type).toBe("step-error");
		if (event?.type !== "step-error") throw new Error("unreachable");
		expect(event.step).toBe("bootstrap");
		expect(event.message).toContain("did not answer SELECT 1");
		expect(event.message).toContain("secondlayer:***@127.0.0.1:1");
		expect(event.message).not.toContain("s3cret");
	});

	test("the child env prefers the generated .env over the shell for the keys it holds", async () => {
		const { config, secrets, files } = await setupDir();
		const shell = {
			PATH: process.env.PATH,
			DATABASE_URL:
				"postgres://postgres:postgres@localhost:5432/secondlayer_dev",
			HOME: "/nowhere",
		};
		const env = buildChildEnv(files.envPath, shell);
		expect(env.DATABASE_URL).toBe(setupDatabaseUrl(config, secrets));
		expect(env.INSTANCE_TOKEN).toBe(secrets.instance.INSTANCE_TOKEN);
		expect(env.ARCHIVE_SIGNING_PUBLIC_KEY).toBe(
			secrets.instance.ARCHIVE_SIGNING_PUBLIC_KEY,
		);
		expect(env.SL_API_URL).toBe(secrets.instance.SL_API_URL);
		expect(env.HOME).toBe("/nowhere");
	});

	test("the spawned bootstrap/verify child sees DATABASE_URL, not the parent's inherited env", async () => {
		// The failure this pins: setup used to spawn the CLI with the parent's
		// env only, so bootstrap restored into whatever DATABASE_URL the shell
		// had (the shared dev URL by default), never the Postgres setup started.
		const { config, secrets, files } = await setupDir();
		const child = join(tmpDir(), "child.ts");
		writeFileSync(
			child,
			"process.stdout.write(JSON.stringify({ DATABASE_URL: process.env.DATABASE_URL ?? null }));",
		);
		const res = await runStreaming(process.execPath, [child], {
			cwd: config.dir,
			env: buildChildEnv(files.envPath, { PATH: process.env.PATH }),
		});
		expect(res.code).toBe(0);
		expect(JSON.parse(res.stdout)).toEqual({
			DATABASE_URL: setupDatabaseUrl(config, secrets),
		});
	});

	test("printing a database URL never prints its password", () => {
		expect(redactUrl("postgres://secondlayer:s3cret@127.0.0.1:5432/db")).toBe(
			"postgres://secondlayer:***@127.0.0.1:5432/db",
		);
	});
});

describe("buildSuccessSummary", () => {
	test("includes the INSTANCE_TOKEN export line and a copy-pasteable curl", () => {
		const dir = tmpDir();
		const config = resolveNonInteractiveConfig({
			network: "mainnet",
			nodeMode: "external",
			skipBootstrap: true,
			dir,
		});
		const secrets = resolveSecrets({
			dir,
			network: config.network,
			apiPort: config.apiPort,
			force: false,
		});
		const summary = buildSuccessSummary(config, secrets);
		expect(summary).toContain(
			`export INSTANCE_TOKEN=${secrets.instance.INSTANCE_TOKEN}`,
		);
		expect(summary).toContain("http://127.0.0.1:3800");
		expect(summary).toContain("secondlayer subgraphs deploy");
	});
});
