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
} from "./control-db.ts";
import {
	type ComposeResult,
	type ProvisionerConfig,
	buildTenantEnv,
	destroy,
	generateTenantSecrets,
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
		});
		const rendered = renderEnvFile(env);
		expect(rendered).not.toMatch(/-----BEGIN PRIVATE KEY-----\n/); // no bare newline mid-value
		expect(rendered).toContain("TENANT_HOSTED_READ_KEY=sk-sl_reader");
		expect(rendered).toContain("HOSTED_API_URL=https://api.secondlayer.tools");
	});
});

describe.skipIf(!HAS_DB)("provisioner up/stop/start/destroy", () => {
	let secretsRoot: string;
	const composeCalls: Array<{ args: string[]; env: Record<string, string> }> =
		[];
	let nextResult: ComposeResult = { code: 0, stdout: "", stderr: "" };

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
		};
	}

	beforeAll(async () => {
		await ensureControlSchema(db);
	});

	afterEach(() => {
		composeCalls.length = 0;
		nextResult = { code: 0, stdout: "", stderr: "" };
		if (secretsRoot) rmSync(secretsRoot, { recursive: true, force: true });
	});

	afterAll(async () => {
		await db.end();
	});

	test("up() writes root-only secrets and brings the stack up exactly once", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		const acct8 = acct8For(accountId);

		const state = await up(cfg(), accountId, "sk-sl_reader");
		expect(state).toBe("running");

		const envPath = join(secretsRoot, acct8, ".env");
		expect(existsSync(envPath)).toBe(true);
		const mode = statSync(envPath).mode & 0o777;
		expect(mode).toBe(0o600);
		const contents = readFileSync(envPath, "utf8");
		expect(contents).toContain("INSTANCE_TOKEN=");
		expect(contents).toContain("TENANT_HOSTED_READ_KEY=sk-sl_reader");

		expect(composeCalls).toHaveLength(1);
		expect(composeCalls[0]?.args).toContain(`tenant-${acct8}`);
		expect(composeCalls[0]?.args).toContain("up");

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("running");

		await deleteTenant(db, accountId);
	});

	test("up() is idempotent: a second call on a running tenant never calls compose again", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;

		await up(cfg(), accountId, "sk-sl_reader");
		expect(composeCalls).toHaveLength(1);

		const state = await up(cfg(), accountId, "sk-sl_reader");
		expect(state).toBe("running");
		expect(composeCalls).toHaveLength(1); // no second compose invocation

		await deleteTenant(db, accountId);
	});

	test("up() surfaces a non-zero compose exit as a thrown error, tenant stays provisioning", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		nextResult = { code: 1, stdout: "", stderr: "boom" };

		await expect(up(cfg(), accountId, "sk-sl_reader")).rejects.toThrow(
			/docker compose up failed/,
		);
		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("provisioning");

		await deleteTenant(db, accountId);
	});

	test("stop() transitions running → stopped and stops the app services, not postgres", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg(), accountId, "sk-sl_reader");
		composeCalls.length = 0;

		await stop(cfg(), accountId);
		expect(composeCalls).toHaveLength(1);
		expect(composeCalls[0]?.args).toContain("stop");
		expect(composeCalls[0]?.args).not.toContain("postgres");

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("stopped");
		expect(row?.stopped_at).not.toBeNull();

		await deleteTenant(db, accountId);
	});

	test("up() on a stopped tenant restarts it instead of re-provisioning", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg(), accountId, "sk-sl_reader");
		await stop(cfg(), accountId);
		composeCalls.length = 0;

		const state = await up(cfg(), accountId, "sk-sl_reader");
		expect(state).toBe("running");
		expect(composeCalls).toHaveLength(1);
		expect(composeCalls[0]?.args).toContain("up");

		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("running");

		await deleteTenant(db, accountId);
	});

	test("start() undoes stop()", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg(), accountId, "sk-sl_reader");
		await stop(cfg(), accountId);

		await start(cfg(), accountId);
		const row = await getTenant(db, accountId);
		expect(row?.state).toBe("running");

		await deleteTenant(db, accountId);
	});

	test("destroy() removes the control-db row after a successful compose down -v", async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-secrets-"));
		const accountId = `test-${crypto.randomUUID()}`;
		await up(cfg(), accountId, "sk-sl_reader");

		await destroy(cfg(), accountId);
		expect(await getTenant(db, accountId)).toBeUndefined();

		const lastCall = composeCalls.at(-1);
		expect(lastCall?.args).toContain("down");
		expect(lastCall?.args).toContain("-v");
	});
});
