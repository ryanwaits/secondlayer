import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_ARCHIVE_MANIFEST,
	MissingSetupFlagError,
	buildSuccessSummary,
	composeProfileArgs,
	guardrailPreview,
	resolveNonInteractiveConfig,
	resolveSecrets,
	writeSetupFiles,
} from "./setup-wizard.ts";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "sl-setup-"));
}

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
	test("stacks and full add their bundled-node profiles", () => {
		expect(composeProfileArgs("stacks")).toEqual(["--profile", "stacks-node"]);
		expect(composeProfileArgs("full")).toEqual(["--profile", "full-node"]);
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

	test("bundled node modes also write Config.toml (and bitcoin.conf for full)", async () => {
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
		expect(stacksFiles.configTomlPath).toBeDefined();
		expect(stacksFiles.bitcoinConfPath).toBeUndefined();

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
