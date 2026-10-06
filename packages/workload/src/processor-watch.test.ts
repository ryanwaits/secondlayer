import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import {
	acct8For,
	deleteTenant,
	ensureControlSchema,
	insertProvisioningTenant,
	setTenantState,
} from "./control-db.ts";
import {
	MAX_RESTARTS_PER_HEIGHT,
	type ProcessorWatchDeps,
	STALL_MS,
	type SubgraphCursor,
	createProcessorWatch,
	realProcessorWatchDeps,
} from "./processor-watch.ts";
import { type ProvisionerConfig, renderEnvFile } from "./provisioner.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB
	? postgres(process.env.DATABASE_URL as string)
	: (null as never);

const MINUTE = 60_000;

describe.skipIf(!HAS_DB)("processor watch", () => {
	let secretsRoot: string;
	let now: number;
	let tip: number | null;
	let oom: { oomKilled: boolean; finishedAt: string } | null;
	let subgraphs: Record<string, SubgraphCursor[]>;
	let restarts: string[];
	let halts: { account: string; name: string; reason: string }[];
	const accounts: string[] = [];

	function cfg(): ProvisionerConfig {
		return {
			db,
			secretsRoot,
			composeFile: "docker/workload/tenant.compose.yml",
			hostedApiUrl: "https://api.secondlayer.tools",
			getTargetSha: () => "a".repeat(40),
		};
	}

	function deps(): ProcessorWatchDeps {
		return {
			inspectProcessor: async () => oom,
			listSubgraphs: async (t) => {
				const rows = subgraphs[t.instanceToken];
				if (!rows) throw new Error("tenant api down");
				return rows;
			},
			haltSubgraph: async (t, name, reason) => {
				halts.push({ account: t.instanceToken, name, reason });
			},
			hostedTip: async () => tip,
			restartProcessor: async (tenant) => {
				restarts.push(tenant.account_id);
				return true;
			},
			now: () => now,
		};
	}

	async function seedTenant(): Promise<string> {
		const accountId = `test-${crypto.randomUUID()}`;
		const acct8 = acct8For(accountId);
		await insertProvisioningTenant(db, accountId, acct8);
		await setTenantState(db, accountId, "running");
		mkdirSync(join(secretsRoot, acct8), { recursive: true });
		// The instance token doubles as the key into the fake api's data.
		writeFileSync(
			join(secretsRoot, acct8, ".env"),
			renderEnvFile({ INSTANCE_TOKEN: accountId }),
		);
		accounts.push(accountId);
		subgraphs[accountId] = [];
		return accountId;
	}

	function sub(name: string, height: number, status = "active") {
		return { name, status, lastProcessedBlock: height };
	}

	beforeAll(async () => {
		secretsRoot = mkdtempSync(join(tmpdir(), "workload-watch-"));
		await ensureControlSchema(db);
	});

	afterEach(async () => {
		for (const id of accounts.splice(0)) await deleteTenant(db, id);
		restarts = [];
		halts = [];
	});

	afterAll(async () => {
		rmSync(secretsRoot, { recursive: true, force: true });
		await db.end();
	});

	function reset() {
		now = 1_000_000;
		tip = 100;
		oom = { oomKilled: false, finishedAt: "0001-01-01T00:00:00Z" };
		subgraphs = {};
		restarts = [];
		halts = [];
	}

	test("a healthy tenant (cursor moving, tip moving) is never restarted", async () => {
		reset();
		const id = await seedTenant();
		const tick = createProcessorWatch(cfg(), deps());

		for (let i = 0; i < 6; i++) {
			subgraphs[id] = [sub("s", 10 + i)];
			tip = 100 + i;
			now += 5 * MINUTE;
			await tick();
		}
		expect(restarts).toEqual([]);
		expect(halts).toEqual([]);
	});

	test("a cursor frozen past the stall window while the tip moves restarts the processor", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("s", 10)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick(); // baseline
		tip = 110;
		now += STALL_MS - MINUTE;
		await tick(); // not stale yet
		expect(restarts).toEqual([]);

		now += 2 * MINUTE;
		await tick();
		expect(restarts).toEqual([id]);
	});

	test("a frozen cursor with a frozen tip is not a stall", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("s", 10)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		now += 3 * STALL_MS;
		await tick();
		expect(restarts).toEqual([]);
	});

	test("an unknown hosted tip never triggers a stall restart", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("s", 10)];
		tip = null;
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		now += 3 * STALL_MS;
		await tick();
		expect(restarts).toEqual([]);
	});

	test("an OOM-killed processor is restarted once per death, not on every tick", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("s", 10)];
		const tick = createProcessorWatch(cfg(), deps());

		oom = { oomKilled: true, finishedAt: "2026-10-06T10:00:00Z" };
		await tick();
		await tick(); // the flag is sticky; same death
		expect(restarts).toEqual([id]);

		oom = { oomKilled: true, finishedAt: "2026-10-06T11:00:00Z" };
		await tick();
		expect(restarts).toEqual([id, id]);
	});

	test("after the third restart at the same cursor height the subgraph is halted through the tenant api", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("stuck", 10), sub("fine", 50)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick(); // baseline
		for (let i = 0; i < MAX_RESTARTS_PER_HEIGHT; i++) {
			tip = (tip ?? 0) + 5;
			now += STALL_MS + MINUTE;
			// `fine` keeps moving; `stuck` never does.
			subgraphs[id] = [sub("stuck", 10), sub("fine", 50 + i + 1)];
			await tick();
		}

		expect(restarts).toHaveLength(MAX_RESTARTS_PER_HEIGHT);
		expect(halts).toHaveLength(1);
		expect(halts[0]?.name).toBe("stuck");
		expect(halts[0]?.reason).toContain("block 10");
	});

	test("a cursor that moves resets the restart count", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("s", 10)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		for (let round = 0; round < 4; round++) {
			// Stall at a NEW height each round, restart once, then move on.
			tip = (tip ?? 0) + 5;
			now += STALL_MS + MINUTE;
			await tick();
			subgraphs[id] = [sub("s", 20 + round)];
			await tick();
			tip = (tip ?? 0) + 5;
		}
		expect(halts).toEqual([]);
		expect(restarts.length).toBeGreaterThan(0);
	});

	test("only active subgraphs are tracked: an errored one is left alone", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("done", 10, "error")];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		tip = 200;
		now += 3 * STALL_MS;
		await tick();
		expect(restarts).toEqual([]);
	});

	test("one tenant's failing api doesn't stop the others from being checked", async () => {
		reset();
		const broken = await seedTenant();
		const healthy = await seedTenant();
		Reflect.deleteProperty(subgraphs, broken); // its api "is down"
		subgraphs[healthy] = [sub("s", 10)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		tip = 200;
		now += STALL_MS + MINUTE;
		await tick();
		expect(restarts).toEqual([healthy]);
	});
});

describe("realProcessorWatchDeps", () => {
	const base: ProvisionerConfig = {
		db: null as never,
		secretsRoot: "/unused",
		composeFile: "docker/workload/tenant.compose.yml",
		hostedApiUrl: "https://api.secondlayer.tools/",
		getTargetSha: () => "b".repeat(40),
	};

	test("inspects the processor container and parses the OOM flag", async () => {
		const calls: string[][] = [];
		const d = realProcessorWatchDeps(base, {
			runDocker: async (args) => {
				calls.push(args);
				return {
					code: 0,
					stdout: "true 2026-10-06T10:00:00.123456789Z\n",
					stderr: "",
				};
			},
		});
		expect(await d.inspectProcessor("abcd1234")).toEqual({
			oomKilled: true,
			finishedAt: "2026-10-06T10:00:00.123456789Z",
		});
		expect(calls[0]).toContain("tenant-abcd1234-subgraph-processor-1");
	});

	test("a missing container is null, not an error", async () => {
		const d = realProcessorWatchDeps(base, {
			runDocker: async () => ({ code: 1, stdout: "", stderr: "No such" }),
		});
		expect(await d.inspectProcessor("abcd1234")).toBeNull();
	});

	test("restart targets only subgraph-processor, on the tag the tenant already runs", async () => {
		const calls: { args: string[]; env: Record<string, string> }[] = [];
		const d = realProcessorWatchDeps(base, {
			runCompose: async (args, env) => {
				calls.push({ args, env });
				return { code: 0, stdout: "", stderr: "" };
			},
		});
		const ok = await d.restartProcessor({
			acct8: "abcd1234",
			image_sha: "c".repeat(40),
		} as never);
		expect(ok).toBe(true);
		expect(calls[0]?.args.slice(-2)).toEqual(["restart", "subgraph-processor"]);
		expect(calls[0]?.env.WORKLOAD_IMAGE_TAG).toBe("c".repeat(40));
	});

	test("halt posts the reason with the tenant's instance token", async () => {
		const seen: { url: string; auth: string | null; body: string }[] = [];
		const d = realProcessorWatchDeps(base, {
			fetchImpl: (async (url: string, init?: RequestInit) => {
				seen.push({
					url,
					auth: new Headers(init?.headers).get("authorization"),
					body: String(init?.body),
				});
				return new Response("{}", { status: 200 });
			}) as unknown as typeof fetch,
		});
		await d.haltSubgraph(
			{ baseUrl: "http://127.0.0.1:20001", instanceToken: "tok" },
			"my-sub",
			"why",
		);
		expect(seen[0]).toEqual({
			url: "http://127.0.0.1:20001/api/subgraphs/my-sub/halt",
			auth: "Bearer tok",
			body: JSON.stringify({ reason: "why" }),
		});
	});
});
