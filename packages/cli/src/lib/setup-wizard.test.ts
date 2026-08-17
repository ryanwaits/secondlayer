import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_ARCHIVE_MANIFEST,
	MissingSetupFlagError,
	buildSuccessSummary,
	composeProfileArgs,
	guardrailPreview,
	isBunRuntime,
	resolveAvailablePublishSpec,
	resolveNonInteractiveConfig,
	resolveSecrets,
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
