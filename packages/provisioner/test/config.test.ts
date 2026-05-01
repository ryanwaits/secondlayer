import { afterEach, describe, expect, test } from "bun:test";
import { getConfig, resetConfigForTests } from "../src/config.ts";
import { withProvisionerRuntimeEnv } from "../src/lifecycle.ts";
import { buildApiSpec, buildProcessorSpec } from "../src/provision.ts";

const ORIGINAL_ENV = { ...process.env };

function setRequiredEnv(overrides: Record<string, string | undefined> = {}) {
	process.env.PROVISIONER_SECRET = "secret";
	process.env.PROVISIONER_SOURCE_DB_ADMIN_URL =
		"postgres://secondlayer:pw@postgres:5432/secondlayer";
	process.env.PROVISIONER_SOURCE_DB_READONLY_PASSWORD = "readonly";
	process.env.STACKS_NODE_RPC_URL = "http://stacks:20443";
	process.env.SECONDLAYER_SECRETS_KEY = "a".repeat(64);
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	resetConfigForTests();
}

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
	resetConfigForTests();
});

describe("provisioner runtime secrets config", () => {
	test("requires SECONDLAYER_SECRETS_KEY at startup", () => {
		setRequiredEnv({ SECONDLAYER_SECRETS_KEY: undefined });

		expect(() => getConfig()).toThrow(
			"Missing required env var: SECONDLAYER_SECRETS_KEY",
		);
	});

	test("injects the secrets key into tenant runtime env", () => {
		setRequiredEnv();
		const cfg = getConfig();

		expect(
			withProvisionerRuntimeEnv(
				{
					DATABASE_URL: "postgres://tenant",
					SECONDLAYER_SECRETS_KEY: "old",
				},
				cfg,
			).SECONDLAYER_SECRETS_KEY,
		).toBe("a".repeat(64));
	});

	test("adds secrets key to freshly provisioned API and processor specs", () => {
		const common = {
			image: "secondlayer-api:latest",
			slug: "tenant1",
			plan: "hobby" as const,
			alloc: { memoryMb: 256, cpus: 0.5 },
			targetDatabaseUrl: "postgres://target",
			sourceDatabaseUrl: "postgres://source",
			stacksNodeRpcUrl: "http://stacks:20443",
			secretsKey: "b".repeat(64),
		};

		const api = buildApiSpec({
			...common,
			name: "sl-api-tenant1",
			jwtSecret: "jwt-secret",
		});
		const processor = buildProcessorSpec({
			...common,
			name: "sl-processor-tenant1",
		});

		expect(api.env?.SECONDLAYER_SECRETS_KEY).toBe("b".repeat(64));
		expect(processor.env?.SECONDLAYER_SECRETS_KEY).toBe("b".repeat(64));
	});
});
