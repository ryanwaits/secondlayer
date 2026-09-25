import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import {
	acct8For,
	deleteTenant,
	ensureControlSchema,
	getTenant,
	insertProvisioningTenant,
	setTenantImageSha,
	setTenantState,
} from "./control-db.ts";
import type { ProvisionerConfig } from "./provisioner.ts";
import {
	type TargetShaCache,
	createUpgradeRunner,
	resolveTargetSha,
	upgradeTenants,
} from "./upgrade.ts";

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const GOOD_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

describe("resolveTargetSha", () => {
	test("a good sha is returned and cached", async () => {
		const cache: TargetShaCache = { lastGood: null };
		const sha = await resolveTargetSha(
			"https://api.secondlayer.tools",
			async () => jsonResponse(200, { status: "ok", image_sha: GOOD_SHA }),
			cache,
		);
		expect(sha).toBe(GOOD_SHA);
		expect(cache.lastGood).toBe(GOOD_SHA);
	});

	test("a missing image_sha field falls back to null when there's no last-known value", async () => {
		const cache: TargetShaCache = { lastGood: null };
		const sha = await resolveTargetSha(
			"https://api.secondlayer.tools",
			async () => jsonResponse(200, { status: "ok" }),
			cache,
		);
		expect(sha).toBeNull();
	});

	test("a badly-formatted sha falls back to null when there's no last-known value", async () => {
		const cache: TargetShaCache = { lastGood: null };
		const sha = await resolveTargetSha(
			"https://api.secondlayer.tools",
			async () => jsonResponse(200, { status: "ok", image_sha: "not-a-sha" }),
			cache,
		);
		expect(sha).toBeNull();
	});

	test("a 500 falls back to null when there's no last-known value", async () => {
		const cache: TargetShaCache = { lastGood: null };
		const sha = await resolveTargetSha(
			"https://api.secondlayer.tools",
			async () => jsonResponse(500, { error: "boom" }),
			cache,
		);
		expect(sha).toBeNull();
	});

	test("a network error falls back to null when there's no last-known value", async () => {
		const cache: TargetShaCache = { lastGood: null };
		const sha = await resolveTargetSha(
			"https://api.secondlayer.tools",
			async () => {
				throw new Error("ECONNREFUSED");
			},
			cache,
		);
		expect(sha).toBeNull();
	});

	test("never falls back to `latest` — a failure after a good resolution keeps the last-known sha", async () => {
		const cache: TargetShaCache = { lastGood: GOOD_SHA };
		const sha = await resolveTargetSha(
			"https://api.secondlayer.tools",
			async () => jsonResponse(500, { error: "boom" }),
			cache,
		);
		expect(sha).toBe(GOOD_SHA);
		expect(cache.lastGood).toBe(GOOD_SHA); // unchanged, not cleared
	});

	test("a network error after a good resolution keeps the last-known sha", async () => {
		const cache: TargetShaCache = { lastGood: GOOD_SHA };
		const sha = await resolveTargetSha(
			"https://api.secondlayer.tools",
			async () => {
				throw new Error("ECONNREFUSED");
			},
			cache,
		);
		expect(sha).toBe(GOOD_SHA);
	});

	test("a fresh good resolution replaces an older last-known sha", async () => {
		const cache: TargetShaCache = { lastGood: OTHER_SHA };
		const sha = await resolveTargetSha(
			"https://api.secondlayer.tools",
			async () => jsonResponse(200, { status: "ok", image_sha: GOOD_SHA }),
			cache,
		);
		expect(sha).toBe(GOOD_SHA);
		expect(cache.lastGood).toBe(GOOD_SHA);
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB
	? postgres(process.env.DATABASE_URL as string)
	: (null as never);

describe.skipIf(!HAS_DB)("upgradeTenants", () => {
	let secretsRoot: string;
	let composeCalls: Array<{ args: string[]; env: Record<string, string> }>;

	function cfg(runCompose: ProvisionerConfig["runCompose"]): ProvisionerConfig {
		return {
			db,
			secretsRoot,
			composeFile: "docker/workload/tenant.compose.yml",
			hostedApiUrl: "https://api.secondlayer.tools",
			runCompose,
			getTargetSha: () => GOOD_SHA,
		};
	}

	async function seedRunningTenant(imageSha: string | null): Promise<string> {
		const accountId = `test-${crypto.randomUUID()}`;
		await insertProvisioningTenant(db, accountId, acct8For(accountId));
		await setTenantState(db, accountId, "running");
		if (imageSha) await setTenantImageSha(db, accountId, imageSha);
		return accountId;
	}

	beforeAll(async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-upgrade-"));
		await ensureControlSchema(db);
	});

	afterEach(() => {
		composeCalls = [];
	});

	afterAll(async () => {
		rmSync(secretsRoot, { recursive: true, force: true });
		await db.end();
	});

	test("two stale tenants are both upgraded — one pull and one up per tenant, rows updated", async () => {
		const a = await seedRunningTenant(OTHER_SHA);
		const b = await seedRunningTenant(OTHER_SHA);
		composeCalls = [];

		await upgradeTenants(
			cfg(async (args, env) => {
				composeCalls.push({ args, env });
				return { code: 0, stdout: "", stderr: "" };
			}),
			GOOD_SHA,
		);

		expect(composeCalls).toHaveLength(4); // pull + up, for each of the two tenants
		for (const acct8 of [acct8For(a), acct8For(b)]) {
			const forThisTenant = composeCalls.filter((c) =>
				c.args.includes(`tenant-${acct8}`),
			);
			expect(forThisTenant.map((c) => c.args.includes("pull"))).toEqual([
				true,
				false,
			]);
			expect(forThisTenant.map((c) => c.args.includes("up"))).toEqual([
				false,
				true,
			]);
		}
		for (const call of composeCalls) {
			expect(call.env.WORKLOAD_IMAGE_TAG).toBe(GOOD_SHA);
		}

		expect((await getTenant(db, a))?.image_sha).toBe(GOOD_SHA);
		expect((await getTenant(db, b))?.image_sha).toBe(GOOD_SHA);

		await deleteTenant(db, a);
		await deleteTenant(db, b);
	});

	test("the first-processed tenant's up failure rolls it back to its previous sha and leaves the other untouched", async () => {
		const a = await seedRunningTenant(OTHER_SHA);
		const b = await seedRunningTenant(OTHER_SHA);
		composeCalls = [];

		// Fail whichever tenant's `up -d --wait` (on the new target) runs
		// first — `listRunningTenants`' order isn't asserted anywhere else in
		// this file, so this test doesn't assume it either.
		let failedOnce = false;
		await upgradeTenants(
			cfg(async (args, env) => {
				composeCalls.push({ args, env });
				if (
					!failedOnce &&
					args.includes("up") &&
					env.WORKLOAD_IMAGE_TAG === GOOD_SHA
				) {
					failedOnce = true;
					return { code: 1, stdout: "", stderr: "unhealthy" };
				}
				return { code: 0, stdout: "", stderr: "" };
			}),
			GOOD_SHA,
		);

		const callsFor = (accountId: string) =>
			composeCalls.filter((c) =>
				c.args.includes(`tenant-${acct8For(accountId)}`),
			);
		const [touchedId, untouchedId] = callsFor(a).length > 0 ? [a, b] : [b, a];
		const touchedCalls = callsFor(touchedId);

		// pull [ok], up on the new target [fails], up on the previous target
		// [rollback] — round stops there, the other tenant is never touched.
		expect(touchedCalls).toHaveLength(3);
		expect(touchedCalls[0]?.args).toContain("pull");
		expect(touchedCalls[1]?.args).toContain("up");
		expect(touchedCalls[1]?.env.WORKLOAD_IMAGE_TAG).toBe(GOOD_SHA);
		expect(touchedCalls[2]?.args).toContain("up");
		expect(touchedCalls[2]?.env.WORKLOAD_IMAGE_TAG).toBe(OTHER_SHA);
		expect(callsFor(untouchedId)).toHaveLength(0);

		// image_sha unchanged for both — rollback never "records" the failed
		// target, and the untouched tenant was never even looked at.
		expect((await getTenant(db, touchedId))?.image_sha).toBe(OTHER_SHA);
		expect((await getTenant(db, untouchedId))?.image_sha).toBe(OTHER_SHA);

		await deleteTenant(db, a);
		await deleteTenant(db, b);
	});

	test("a tenant already on the target sha is skipped with no compose calls", async () => {
		const a = await seedRunningTenant(GOOD_SHA);
		composeCalls = [];

		await upgradeTenants(
			cfg(async (args, env) => {
				composeCalls.push({ args, env });
				return { code: 0, stdout: "", stderr: "" };
			}),
			GOOD_SHA,
		);

		expect(composeCalls).toHaveLength(0);

		await deleteTenant(db, a);
	});

	test("a pull failure stops the round before any compose up call", async () => {
		const a = await seedRunningTenant(OTHER_SHA);
		const b = await seedRunningTenant(OTHER_SHA);
		composeCalls = [];

		await upgradeTenants(
			cfg(async (args, env) => {
				composeCalls.push({ args, env });
				if (args.includes("pull")) {
					return { code: 1, stdout: "", stderr: "no such image" };
				}
				return { code: 0, stdout: "", stderr: "" };
			}),
			GOOD_SHA,
		);

		expect(composeCalls).toHaveLength(1);
		expect(composeCalls[0]?.args).toContain("pull");
		expect(composeCalls.some((c) => c.args.includes("up"))).toBe(false);

		expect((await getTenant(db, a))?.image_sha).toBe(OTHER_SHA);
		expect((await getTenant(db, b))?.image_sha).toBe(OTHER_SHA);

		await deleteTenant(db, a);
		await deleteTenant(db, b);
	});

	test("createUpgradeRunner skips a round that overlaps one still in flight", async () => {
		const a = await seedRunningTenant(OTHER_SHA);
		composeCalls = [];

		let releaseFirstPull: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			releaseFirstPull = resolve;
		});

		const runner = createUpgradeRunner(
			cfg(async (args, env) => {
				if (args.includes("pull")) await gate;
				composeCalls.push({ args, env });
				return { code: 0, stdout: "", stderr: "" };
			}),
		);

		const firstRound = runner(GOOD_SHA); // blocks on the pull gate
		const secondRound = await runner(GOOD_SHA); // must be a no-op, not queued
		expect(secondRound).toBeUndefined();
		expect(composeCalls).toHaveLength(0); // second call never touched compose

		releaseFirstPull?.();
		await firstRound;
		expect(composeCalls).toHaveLength(2); // exactly one round's worth (pull + up)

		await deleteTenant(db, a);
	});
});
