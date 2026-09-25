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
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
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
} from "./control-db.ts";
import {
	type ComposeResult,
	type ProvisionerConfig,
	buildTenantEnv,
	destroy,
	generateTenantSecrets,
	pollCredits,
	renderEnvFile,
	start,
	stop,
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
			hostedApiUrl: "https://api.secondlayer.tools",
			tenantSocketDir: "/tmp/x/sockets",
			apiPort: 20001,
		});
		const rendered = renderEnvFile(env);
		expect(rendered).not.toMatch(/-----BEGIN PRIVATE KEY-----\n/); // no bare newline mid-value
		expect(rendered).toContain("TENANT_HOSTED_READ_KEY=sk-sl_reader");
		expect(rendered).toContain("HOSTED_API_URL=https://api.secondlayer.tools");
		expect(rendered).toContain("TENANT_API_PORT=20001");
	});
});

const TARGET_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

describe.skipIf(!HAS_DB)("provisioner up/stop/start/destroy", () => {
	let secretsRoot: string;
	const composeCalls: Array<{ args: string[]; env: Record<string, string> }> =
		[];
	let nextResult: ComposeResult = { code: 0, stdout: "", stderr: "" };
	let mintCalls: string[] = [];
	let targetSha: string | null = TARGET_SHA;
	const MINTED_KEY = "sk-sl_minted-hosted-stack-key";

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
			mintTenantKey: async (accountId) => {
				mintCalls.push(accountId);
				return MINTED_KEY;
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
		expect(mintCalls).toEqual([accountId]);

		const acct8 = acct8For(accountId);
		const contents = readFileSync(join(secretsRoot, acct8, ".env"), "utf8");
		expect(contents).toContain(`TENANT_HOSTED_READ_KEY=${MINTED_KEY}`);

		await deleteTenant(db, accountId);
	});

	test("up() is idempotent: a second call on a running tenant never calls compose or mint again", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;

		await up(cfg(), accountId);
		expect(composeCalls).toHaveLength(1);
		expect(mintCalls).toHaveLength(1);

		const state = await up(cfg(), accountId);
		expect(state).toBe("running");
		expect(composeCalls).toHaveLength(1); // no second compose invocation
		expect(mintCalls).toHaveLength(1); // no second mint — no key rotation on a no-op

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

	test("stop() transitions running → stopped and stops the app services, not postgres", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg(), accountId);
		composeCalls.length = 0;

		await stop(cfg(), accountId);
		expect(composeCalls).toHaveLength(1);
		expect(composeCalls[0]?.args).toContain("stop");
		expect(composeCalls[0]?.args).not.toContain("postgres");
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
		expect(mintCalls).toHaveLength(0); // restart, not re-provision

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("running");

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
