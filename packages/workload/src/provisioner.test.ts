import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import {
	acct8For,
	deleteTenant,
	ensureControlSchema,
	getTenant,
	insertProvisioningTenant,
	setTenantState,
} from "./control-db.ts";
import {
	type ComposeResult,
	type ProvisionerConfig,
	TENANT_NETWORK_CAPACITY,
	type TenantKeyName,
	buildTenantEnv,
	destroy,
	ensureTenantEnv,
	generateTenantSecrets,
	makeMintTenantKey,
	parseEnvFile,
	pollCredits,
	recoverInterruptedProvisions,
	renderEnvFile,
	start,
	stop,
	tenantNetwork,
	up,
} from "./provisioner.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB
	? postgres(process.env.DATABASE_URL as string)
	: (null as never);

describe("generateTenantSecrets", () => {
	test("every secret is fresh across two calls (no shared/prod fallback)", () => {
		const a = generateTenantSecrets();
		const b = generateTenantSecrets();
		expect(a.instanceToken).not.toBe(b.instanceToken);
		expect(a.postgresPassword).not.toBe(b.postgresPassword);
		expect(a.secondlayerSecretsKey).not.toBe(b.secondlayerSecretsKey);
		expect(a.streamsSigningPrivateKey).not.toBe(b.streamsSigningPrivateKey);
	});

	test("secondlayerSecretsKey is 32 bytes hex (matches SECONDLAYER_SECRETS_KEY's expected shape)", () => {
		const s = generateTenantSecrets();
		expect(s.secondlayerSecretsKey).toMatch(/^[a-f0-9]{64}$/);
	});
});

describe("buildTenantEnv / renderEnvFile", () => {
	test("PEM newlines survive as literal \\n in the rendered env file", () => {
		const secrets = generateTenantSecrets();
		const env = buildTenantEnv({
			secrets,
			accountReadKey: "sk-sl_reader",
			subgraphReadKey: "sk-sl_subgraphs",
			hostedApiUrl: "https://api.secondlayer.tools",
			tenantSocketDir: "/tmp/x/sockets",
			apiPort: 20001,
			subnetIdx: 7,
		});
		const rendered = renderEnvFile(env);
		expect(rendered).not.toMatch(/-----BEGIN PRIVATE KEY-----\n/); // no bare newline mid-value
		expect(rendered).toContain("TENANT_HOSTED_READ_KEY=sk-sl_reader");
		expect(rendered).toContain("HOSTED_API_URL=https://api.secondlayer.tools");
		expect(rendered).toContain("TENANT_API_PORT=20001");
		expect(rendered).toContain("TENANT_SUBGRAPH_READ_KEY=sk-sl_subgraphs");
		expect(rendered).toContain("TENANT_SUBNET=10.64.7.0/24");
		expect(rendered).toContain("TENANT_PG_IP=10.64.7.10");
	});

	test("parseEnvFile inverts renderEnvFile, PEM newlines included", () => {
		const env = buildTenantEnv({
			secrets: generateTenantSecrets(),
			accountReadKey: "a",
			subgraphReadKey: "b",
			hostedApiUrl: "https://api.secondlayer.tools",
			tenantSocketDir: "/tmp/x/sockets",
			apiPort: 20001,
			subnetIdx: 1,
		});
		expect(parseEnvFile(renderEnvFile(env))).toEqual(env);
	});
});

describe("tenantNetwork", () => {
	test("each index gets its own /24 and a postgres address inside it, all in 10.64.0.0/10", () => {
		const seen = new Set<string>();
		for (const idx of [
			1,
			2,
			255,
			256,
			257,
			4096,
			TENANT_NETWORK_CAPACITY - 1,
		]) {
			const { subnet, pgIp } = tenantNetwork(idx);
			expect(seen.has(subnet)).toBe(false);
			seen.add(subnet);
			const [a, b, c] = subnet.split(".").map(Number) as [
				number,
				number,
				number,
			];
			expect(a).toBe(10);
			expect(b).toBeGreaterThanOrEqual(64);
			expect(b).toBeLessThanOrEqual(127);
			expect(subnet).toBe(`10.${b}.${c}.0/24`);
			expect(pgIp).toBe(`10.${b}.${c}.10`);
		}
	});

	test("rejects indexes outside the pool instead of wrapping into another tenant's range", () => {
		expect(() => tenantNetwork(0)).toThrow(/out of range/);
		expect(() => tenantNetwork(-1)).toThrow(/out of range/);
		expect(() => tenantNetwork(TENANT_NETWORK_CAPACITY)).toThrow(
			/out of range/,
		);
	});
});

describe("makeMintTenantKey", () => {
	test("sends the requested key name, so each key is minted and rotated on its own", async () => {
		const bodies: unknown[] = [];
		const mint = makeMintTenantKey(
			"https://api.secondlayer.tools/",
			"host-key",
			async (_url, init) => {
				bodies.push(JSON.parse(String(init?.body)));
				return new Response(JSON.stringify({ key: "sk-sl_k" }), {
					status: 200,
				});
			},
		);
		await mint("acct", "hosted-stack");
		await mint("acct", "hosted-subgraphs");
		expect(bodies).toEqual([
			{ account_id: "acct", name: "hosted-stack" },
			{ account_id: "acct", name: "hosted-subgraphs" },
		]);
	});
});

const TARGET_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

describe.skipIf(!HAS_DB)("provisioner up/stop/start/destroy", () => {
	let secretsRoot: string;
	const composeCalls: Array<{ args: string[]; env: Record<string, string> }> =
		[];
	let nextResult: ComposeResult = { code: 0, stdout: "", stderr: "" };
	let mintCalls: Array<{ accountId: string; name: TenantKeyName }> = [];
	let targetSha: string | null = TARGET_SHA;
	const MINTED_KEY = "sk-sl_minted-hosted-stack-key";
	const MINTED_SUBGRAPH_KEY = "sk-sl_minted-hosted-subgraphs-key";

	function cfg(): ProvisionerConfig {
		return {
			db,
			secretsRoot,
			composeFile: "docker/workload/tenant.compose.yml",
			hostedApiUrl: "https://api.secondlayer.tools",
			runCompose: async (args, env) => {
				composeCalls.push({ args, env });
				return nextResult;
			},
			mintTenantKey: async (accountId, name) => {
				mintCalls.push({ accountId, name });
				return name === "hosted-subgraphs" ? MINTED_SUBGRAPH_KEY : MINTED_KEY;
			},
			getTargetSha: () => targetSha,
		};
	}

	beforeAll(async () => {
		await ensureControlSchema(db);
	});

	afterEach(() => {
		composeCalls.length = 0;
		mintCalls = [];
		nextResult = { code: 0, stdout: "", stderr: "" };
		targetSha = TARGET_SHA;
		if (secretsRoot) rmSync(secretsRoot, { recursive: true, force: true });
	});

	// db.end() happens once, in the LAST describe block below
	// ("pollCredits") — this file's `db` is a single module-level connection
	// shared across both describes.

	test("up() writes root-only secrets and brings the stack up exactly once", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		const acct8 = acct8For(accountId);

		const state = await up(cfg(), accountId);
		expect(state).toBe("running");

		const envPath = join(secretsRoot, acct8, ".env");
		expect(existsSync(envPath)).toBe(true);
		const mode = statSync(envPath).mode & 0o777;
		expect(mode).toBe(0o600);
		const contents = readFileSync(envPath, "utf8");
		expect(contents).toContain("INSTANCE_TOKEN=");
		expect(contents).toContain("TENANT_API_PORT=");

		expect(composeCalls).toHaveLength(1);
		expect(composeCalls[0]?.args).toContain(`tenant-${acct8}`);
		expect(composeCalls[0]?.args).toContain("up");

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("running");
		// The env file's TENANT_API_PORT matches the port the control DB
		// allocated for this tenant — not a made-up or hardcoded value.
		expect(contents).toContain(`TENANT_API_PORT=${row?.api_port}`);
		// Same for the network: derived from the control-DB index, so the file
		// and the allocation can't disagree.
		const network = tenantNetwork(row?.subnet_idx as number);
		expect(contents).toContain(`TENANT_SUBNET=${network.subnet}`);
		expect(contents).toContain(`TENANT_PG_IP=${network.pgIp}`);

		await deleteTenant(db, accountId);
	});

	test("up() passes the target sha as WORKLOAD_IMAGE_TAG and records it on the row", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;

		await up(cfg(), accountId);
		expect(composeCalls[0]?.env.WORKLOAD_IMAGE_TAG).toBe(TARGET_SHA);

		const row = await getTenant(db, accountId);
		expect(row?.image_sha).toBe(TARGET_SHA);

		await deleteTenant(db, accountId);
	});

	test("up() refuses to provision a new tenant when no target has resolved, and leaves no row behind", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		targetSha = null;

		await expect(up(cfg(), accountId)).rejects.toThrow(
			/no resolved image target/,
		);
		expect(composeCalls).toHaveLength(0);
		expect(await getTenant(db, accountId)).toBeUndefined();
	});

	test("up() mints a DEDICATED tenant key — never forwards a customer's presented key (Design fix)", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;

		await up(cfg(), accountId);
		expect(mintCalls).toHaveLength(2);
		expect(mintCalls.map((c) => c.accountId)).toEqual([accountId, accountId]);
		expect(mintCalls.map((c) => c.name).sort()).toEqual([
			"hosted-stack",
			"hosted-subgraphs",
		]);

		const acct8 = acct8For(accountId);
		const contents = readFileSync(join(secretsRoot, acct8, ".env"), "utf8");
		// The internal key and the metered key land in different variables.
		expect(contents).toContain(`TENANT_HOSTED_READ_KEY=${MINTED_KEY}`);
		expect(contents).toContain(
			`TENANT_SUBGRAPH_READ_KEY=${MINTED_SUBGRAPH_KEY}`,
		);

		await deleteTenant(db, accountId);
	});

	test("up() is idempotent: a second call on a running tenant never calls compose or mint again", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;

		await up(cfg(), accountId);
		expect(composeCalls).toHaveLength(1);
		expect(mintCalls).toHaveLength(2);

		const state = await up(cfg(), accountId);
		expect(state).toBe("running");
		expect(composeCalls).toHaveLength(1); // no second compose invocation
		expect(mintCalls).toHaveLength(2); // no second mint — no key rotation on a no-op

		await deleteTenant(db, accountId);
	});

	test("up() surfaces a non-zero compose exit as a thrown error, and cleans up rather than stranding the row (review fix 5)", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		nextResult = { code: 1, stdout: "", stderr: "boom" };

		await expect(up(cfg(), accountId)).rejects.toThrow(
			/docker compose up failed/,
		);

		// The row is gone, not stuck in `provisioning` forever.
		const row = await getTenant(db, accountId);
		expect(row).toBeUndefined();

		// Cleanup called `compose down -v` for the half-started project.
		const cleanupCall = composeCalls.at(-1);
		expect(cleanupCall?.args).toContain("down");
		expect(cleanupCall?.args).toContain("-v");

		// A retried up() starts fresh (no leftover state blocks it) and succeeds.
		nextResult = { code: 0, stdout: "", stderr: "" };
		const state = await up(cfg(), accountId);
		expect(state).toBe("running");

		await deleteTenant(db, accountId);
	});

	test("up() cleans up even when the compose-down cleanup itself fails (logs, doesn't throw over the original error)", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		let call = 0;
		const cfgWithFlakyCleanup: ProvisionerConfig = {
			...cfg(),
			runCompose: async (args, env) => {
				composeCalls.push({ args, env });
				call++;
				if (call === 1) return { code: 1, stdout: "", stderr: "boom" }; // the `up` that fails
				throw new Error("compose down also failed"); // the cleanup attempt
			},
		};

		await expect(up(cfgWithFlakyCleanup, accountId)).rejects.toThrow(
			/docker compose up failed/, // original error surfaces, not the cleanup error
		);
		expect(await getTenant(db, accountId)).toBeUndefined(); // still cleaned up the row
	});

	test("recoverInterruptedProvisions tears down a provisioning row with compose down -v and deletes it", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		const acct8 = acct8For(accountId);
		await insertProvisioningTenant(db, accountId, acct8);

		const count = await recoverInterruptedProvisions(cfg());
		expect(count).toBeGreaterThanOrEqual(1);

		const mine = composeCalls.filter((c) => c.args.includes(`tenant-${acct8}`));
		expect(mine).toHaveLength(1);
		expect(mine[0]?.args).toContain("down");
		expect(mine[0]?.args).toContain("-v");
		expect(mine[0]?.env.WORKLOAD_IMAGE_TAG).toBe(TARGET_SHA);
		expect(await getTenant(db, accountId)).toBeUndefined();
	});

	test("recoverInterruptedProvisions leaves running and stopped tenants alone", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const runningId = `test-${crypto.randomUUID()}`;
		const stoppedId = `test-${crypto.randomUUID()}`;
		await insertProvisioningTenant(db, runningId, acct8For(runningId));
		await setTenantState(db, runningId, "running");
		await insertProvisioningTenant(db, stoppedId, acct8For(stoppedId));
		await setTenantState(db, stoppedId, "stopped");

		await recoverInterruptedProvisions(cfg());

		expect((await getTenant(db, runningId))?.state).toBe("running");
		expect((await getTenant(db, stoppedId))?.state).toBe("stopped");
		const touched = composeCalls.filter(
			(c) =>
				c.args.includes(`tenant-${acct8For(runningId)}`) ||
				c.args.includes(`tenant-${acct8For(stoppedId)}`),
		);
		expect(touched).toHaveLength(0);

		await deleteTenant(db, runningId);
		await deleteTenant(db, stoppedId);
	});

	test("recoverInterruptedProvisions with no resolved target skips compose but still deletes the row", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		targetSha = null;

		await recoverInterruptedProvisions(cfg());

		expect(composeCalls).toHaveLength(0);
		expect(await getTenant(db, accountId)).toBeUndefined();
	});

	test("stop() transitions running → stopped and stops the app services, not postgres", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg(), accountId);
		composeCalls.length = 0;

		await stop(cfg(), accountId);
		expect(composeCalls).toHaveLength(1);
		expect(composeCalls[0]?.args).toContain("stop");
		expect(composeCalls[0]?.args).not.toContain("postgres");
		// A stopped (out-of-credits) tenant must not keep indexing or metering.
		for (const service of [
			"api",
			"webhook-service",
			"migrate",
			"subgraph-processor",
		]) {
			expect(composeCalls[0]?.args).toContain(service);
		}
		// `stop` still needs SOME WORKLOAD_IMAGE_TAG for compose to parse the
		// file — the value it's given doesn't change what's running.
		expect(composeCalls[0]?.env.WORKLOAD_IMAGE_TAG).toBe(TARGET_SHA);

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("stopped");
		expect(row?.stopped_at).not.toBeNull();

		await deleteTenant(db, accountId);
	});

	test("up() on a stopped tenant restarts it instead of re-provisioning (no second mint)", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg(), accountId);
		await stop(cfg(), accountId);
		composeCalls.length = 0;
		mintCalls = [];

		const state = await up(cfg(), accountId);
		expect(state).toBe("running");
		expect(composeCalls).toHaveLength(1);
		expect(composeCalls[0]?.args).toContain("up");
		expect(mintCalls).toHaveLength(0); // restart, not re-provision (key is already in the env)

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("running");

		await deleteTenant(db, accountId);
	});

	/** A tenant provisioned before subgraph hosting: its `.env` lacks the
	 *  metered key and the network vars. */
	async function seedOldTenant(): Promise<{
		accountId: string;
		envPath: string;
	}> {
		const accountId = `test-${crypto.randomUUID()}`;
		const acct8 = acct8For(accountId);
		await insertProvisioningTenant(db, accountId, acct8);
		await setTenantState(db, accountId, "running");
		const dir = join(secretsRoot, acct8);
		mkdirSync(dir, { recursive: true });
		const envPath = join(dir, ".env");
		writeFileSync(
			envPath,
			renderEnvFile({
				POSTGRES_PASSWORD: "pw",
				TENANT_HOSTED_READ_KEY: "sk-sl_internal",
				TENANT_API_PORT: "20001",
			}),
			{ mode: 0o600 },
		);
		return { accountId, envPath };
	}

	test("ensureTenantEnv backfills the metered key and network vars on an old tenant, mode 600, leaving existing values alone", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const { accountId, envPath } = await seedOldTenant();

		await ensureTenantEnv(cfg(), accountId);

		const env = parseEnvFile(readFileSync(envPath, "utf8"));
		const row = await getTenant(db, accountId);
		const network = tenantNetwork(row?.subnet_idx as number);
		expect(env.TENANT_SUBGRAPH_READ_KEY).toBe(MINTED_SUBGRAPH_KEY);
		expect(env.TENANT_SUBNET).toBe(network.subnet);
		expect(env.TENANT_PG_IP).toBe(network.pgIp);
		expect(env.POSTGRES_PASSWORD).toBe("pw");
		expect(env.TENANT_HOSTED_READ_KEY).toBe("sk-sl_internal");
		expect(statSync(envPath).mode & 0o777).toBe(0o600);
		// Only the subgraph key is minted: the internal key is never rotated.
		expect(mintCalls.map((c) => c.name)).toEqual(["hosted-subgraphs"]);

		// A second pass is a no-op: no re-mint (a mint rotates the old key).
		mintCalls = [];
		await ensureTenantEnv(cfg(), accountId);
		expect(mintCalls).toHaveLength(0);

		await deleteTenant(db, accountId);
	});

	test("ensureTenantEnv never throws on a failed mint, still writes the network vars, and retries next time", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const { accountId, envPath } = await seedOldTenant();
		const failing: ProvisionerConfig = {
			...cfg(),
			mintTenantKey: async () => {
				throw new Error("mint tenant key failed: 503");
			},
		};

		await ensureTenantEnv(failing, accountId);

		const env = parseEnvFile(readFileSync(envPath, "utf8"));
		expect(env.TENANT_SUBGRAPH_READ_KEY).toBeUndefined();
		// compose requires these; without them the whole project fails to parse.
		expect(env.TENANT_SUBNET).toMatch(/^10\.\d+\.\d+\.0\/24$/);
		expect(env.TENANT_PG_IP).toBeDefined();

		await ensureTenantEnv(cfg(), accountId);
		expect(
			parseEnvFile(readFileSync(envPath, "utf8")).TENANT_SUBGRAPH_READ_KEY,
		).toBe(MINTED_SUBGRAPH_KEY);

		await deleteTenant(db, accountId);
	});

	test("ensureTenantEnv on a tenant with no env file logs and returns instead of throwing", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await insertProvisioningTenant(db, accountId, acct8For(accountId));

		await expect(ensureTenantEnv(cfg(), accountId)).resolves.toBeUndefined();
		expect(mintCalls).toHaveLength(0);

		await deleteTenant(db, accountId);
	});

	test("start() backfills an old tenant's env before running compose, and a failed backfill doesn't stop the start", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const { accountId, envPath } = await seedOldTenant();
		await setTenantState(db, accountId, "stopped");
		let envAtCompose: Record<string, string> = {};
		const withSnapshot: ProvisionerConfig = {
			...cfg(),
			runCompose: async (args, env) => {
				envAtCompose = parseEnvFile(readFileSync(envPath, "utf8"));
				composeCalls.push({ args, env });
				return nextResult;
			},
		};
		await start(withSnapshot, accountId);
		expect(envAtCompose.TENANT_SUBGRAPH_READ_KEY).toBe(MINTED_SUBGRAPH_KEY);
		expect(envAtCompose.TENANT_SUBNET).toBeDefined();
		expect((await getTenant(db, accountId))?.state).toBe("running");

		// Same tenant, mint down: start still succeeds.
		await setTenantState(db, accountId, "stopped");
		writeFileSync(envPath, renderEnvFile({ POSTGRES_PASSWORD: "pw" }), {
			mode: 0o600,
		});
		await start(
			{
				...cfg(),
				mintTenantKey: async () => {
					throw new Error("down");
				},
			},
			accountId,
		);
		expect((await getTenant(db, accountId))?.state).toBe("running");

		await deleteTenant(db, accountId);
	});

	test("start() undoes stop()", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg(), accountId);
		await stop(cfg(), accountId);

		await start(cfg(), accountId);
		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("running");

		await deleteTenant(db, accountId);
	});

	test("start() always uses the CURRENT target, not whatever the tenant last ran (stopped tenants upgrade lazily)", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg(), accountId); // provisions on TARGET_SHA
		await stop(cfg(), accountId);
		targetSha = OTHER_SHA; // a deploy landed while it was stopped
		composeCalls.length = 0;

		await start(cfg(), accountId);
		expect(composeCalls[0]?.env.WORKLOAD_IMAGE_TAG).toBe(targetSha);

		const row = await getTenant(db, accountId);
		expect(row?.image_sha).toBe(targetSha);

		await deleteTenant(db, accountId);
	});

	test("start() refuses when no target has resolved", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg(), accountId);
		await stop(cfg(), accountId);
		composeCalls.length = 0;
		targetSha = null;

		await expect(start(cfg(), accountId)).rejects.toThrow(
			/no resolved image target/,
		);
		expect(composeCalls).toHaveLength(0);

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("stopped"); // untouched by the refused start

		await deleteTenant(db, accountId);
	});

	test("destroy() removes the control-db row after a successful compose down -v", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg(), accountId);

		await destroy(cfg(), accountId);
		expect(await getTenant(db, accountId)).toBeUndefined();

		const lastCall = composeCalls.at(-1);
		expect(lastCall?.args).toContain("down");
		expect(lastCall?.args).toContain("-v");
	});
});

describe.skipIf(!HAS_DB)("pollCredits (review fix 3a)", () => {
	let secretsRoot: string;
	const composeCalls: Array<{ args: string[]; env: Record<string, string> }> =
		[];

	function cfg(creditsOk: Record<string, boolean>): ProvisionerConfig {
		return {
			db,
			secretsRoot,
			composeFile: "docker/workload/tenant.compose.yml",
			hostedApiUrl: "https://api.secondlayer.tools",
			runCompose: async (args, env) => {
				composeCalls.push({ args, env });
				return { code: 0, stdout: "", stderr: "" };
			},
			mintTenantKey: async () => "sk-sl_minted",
			checkCreditsOk: async (ids) =>
				Object.fromEntries(ids.map((id) => [id, creditsOk[id] ?? false])),
			getTargetSha: () => TARGET_SHA,
		};
	}

	beforeAll(async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-poll-"));
		await ensureControlSchema(db);
	});

	afterEach(() => {
		composeCalls.length = 0;
	});

	afterAll(async () => {
		rmSync(secretsRoot, { recursive: true, force: true });
		await db.end();
	});

	test("running & zero balance → stopped", async () => {
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg({}), accountId);
		composeCalls.length = 0;

		await pollCredits(cfg({ [accountId]: false }));

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("stopped");
		expect(composeCalls.some((c) => c.args.includes("stop"))).toBe(true);

		await deleteTenant(db, accountId);
	});

	test("stopped & topped up → running", async () => {
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg({}), accountId);
		await stop(cfg({}), accountId);
		composeCalls.length = 0;

		await pollCredits(cfg({ [accountId]: true }));

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("running");
		expect(composeCalls.some((c) => c.args.includes("up"))).toBe(true);

		await deleteTenant(db, accountId);
	});

	test("running & funded stays running (no compose call)", async () => {
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg({}), accountId);
		composeCalls.length = 0;

		await pollCredits(cfg({ [accountId]: true }));

		expect(composeCalls).toHaveLength(0);
		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("running");

		await deleteTenant(db, accountId);
	});

	test("provisioning tenants are excluded from the poll", async () => {
		const accountId = `test-${crypto.randomUUID()}`;
		await insertProvisioningTenant(db, accountId, acct8For(accountId));

		await pollCredits(cfg({ [accountId]: false }));

		expect(composeCalls).toHaveLength(0);
		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("provisioning"); // untouched

		await deleteTenant(db, accountId);
	});

	test("one tenant's transition failure doesn't stop the rest of the batch", async () => {
		const good = `test-${crypto.randomUUID()}`;
		const bad = `test-${crypto.randomUUID()}`;
		await up(cfg({}), good);
		await up(cfg({}), bad);
		composeCalls.length = 0;

		let call = 0;
		const cfgFlaky: ProvisionerConfig = {
			...cfg({ [good]: false, [bad]: false }),
			runCompose: async (args, env) => {
				call++;
				if (args.includes(`tenant-${acct8For(bad)}`)) {
					throw new Error("compose stop failed for bad tenant");
				}
				composeCalls.push({ args, env });
				return { code: 0, stdout: "", stderr: "" };
			},
		};
		await pollCredits(cfgFlaky);

		const goodRow = await getTenant(db, good);
		expect(goodRow?.state).toBe("stopped"); // succeeded despite the other failing
		const badRow = await getTenant(db, bad);
		expect(badRow?.state).toBe("running"); // untouched by its own failed transition

		await deleteTenant(db, good);
		await deleteTenant(db, bad);
		void call;
	});
});
