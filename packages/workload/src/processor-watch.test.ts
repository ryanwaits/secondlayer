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
	type ProcessorState,
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
	let container: ProcessorState | null;
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
			inspectProcessor: async () => container,
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
		const accountId = crypto.randomUUID();
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

	function sub(
		name: string,
		height: number,
		status = "active",
		queued = false,
	) {
		return { name, status, lastProcessedBlock: height, queued };
	}

	/** Docker restarts a crashed processor; the flag it leaves behind is false. */
	function crashed(restartCount: number): ProcessorState {
		return {
			restartCount,
			oomKilled: false,
			exitCode: 137,
			finishedAt: `2026-10-06T10:0${restartCount}:00Z`,
		};
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
		tip = 1_000_000;
		container = {
			restartCount: 0,
			oomKilled: false,
			exitCode: 0,
			finishedAt: "0001-01-01T00:00:00Z",
		};
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
		tip = 1_000_010;
		now += STALL_MS - MINUTE;
		await tick(); // not stale yet
		expect(restarts).toEqual([]);

		now += 2 * MINUTE;
		await tick();
		expect(restarts).toEqual([id]);
	});

	const paused = (name: string, height: number): SubgraphCursor => ({
		...sub(name, height),
		lastError: "billing_paused: spend_cap_reached",
	});

	test("a billing-paused subgraph with a frozen cursor and a moving tip is never restarted or halted", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [paused("s", 10)];
		const tick = createProcessorWatch(cfg(), deps());

		for (let i = 0; i < 2 * MAX_RESTARTS_PER_HEIGHT + 4; i++) {
			tip = (tip ?? 0) + 50;
			now += STALL_MS;
			await tick();
		}
		expect(restarts).toEqual([]);
		expect(halts).toEqual([]);
	});

	test("a pause that ends restarts the stall clock instead of reading the frozen cursor as a stall", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [paused("s", 10)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		tip = (tip ?? 0) + 50;
		now += 3 * STALL_MS;
		await tick();
		await tick();

		// Billing recovered: the code clears, the cursor has yet to move.
		subgraphs[id] = [sub("s", 10)];
		tip = (tip ?? 0) + 50;
		now += 5 * MINUTE;
		await tick();
		expect(restarts).toEqual([]);

		// Still frozen a full window later: a real stall again.
		tip = (tip ?? 0) + 50;
		now += STALL_MS + MINUTE;
		await tick();
		expect(restarts).toEqual([id]);
	});

	test("a frozen subgraph still restarts while a paused one beside it is left alone", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [paused("capped", 10), sub("wedged", 20)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		tip = (tip ?? 0) + 50;
		now += STALL_MS + MINUTE;
		await tick();
		expect(restarts).toEqual([id]);
		expect(halts).toEqual([]);
		for (let i = 0; i < MAX_RESTARTS_PER_HEIGHT; i++) {
			tip = (tip ?? 0) + 50;
			now += STALL_MS + MINUTE;
			await tick();
		}
		expect(halts.map((h) => h.name)).toEqual(["wedged"]);
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

	test("a processor docker already restarted is counted as a death, never restarted again", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("s", 10)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick(); // baseline: restartCount 0
		container = crashed(1); // docker restarted it; OOMKilled reads false
		await tick();
		await tick(); // same count: same death, not counted twice
		expect(restarts).toEqual([]);
		expect(halts).toEqual([]);
	});

	test("an OOM kill the flag still shows is counted once per death, not on every tick", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("s", 10)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick(); // baseline
		container = {
			restartCount: 0,
			oomKilled: true,
			exitCode: 137,
			finishedAt: "2026-10-06T10:00:00Z",
		};
		await tick();
		await tick(); // the flag is sticky; same death
		await tick();
		expect(halts).toEqual([]); // 1 death, below the threshold

		container = { ...container, finishedAt: "2026-10-06T11:00:00Z" };
		await tick();
		container = { ...container, finishedAt: "2026-10-06T12:00:00Z" };
		await tick(); // third distinct death at the same cursor
		expect(halts.map((h) => h.name)).toEqual(["s"]);
		expect(restarts).toEqual([]);
	});

	test("three deaths at the same reindex cursor halt that subgraph once, not an innocent active one", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("reindexed", 500, "reindexing"), sub("innocent", 50)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick(); // baseline
		for (let i = 1; i <= MAX_RESTARTS_PER_HEIGHT; i++) {
			// The reindex is stuck at 500 while the processor dies under it; the
			// innocent subgraph's cursor keeps moving.
			subgraphs[id] = [
				sub("reindexed", 500, "reindexing"),
				sub("innocent", 50 + i * 5_000),
			];
			container = crashed(i);
			await tick();
		}

		expect(halts).toHaveLength(1);
		expect(halts[0]?.name).toBe("reindexed");
		expect(halts[0]?.reason).toContain("block 500");
		expect(restarts).toEqual([]);
	});

	test("several deaths between two ticks all count toward the halt", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("stuck", 10)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		container = crashed(MAX_RESTARTS_PER_HEIGHT);
		await tick();
		expect(halts.map((h) => h.name)).toEqual(["stuck"]);
	});

	test("a reindex still waiting in the queue is never blamed for a death", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("waiting", 0, "reindexing", true), sub("busy", 7)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		for (let i = 1; i <= MAX_RESTARTS_PER_HEIGHT; i++) {
			container = crashed(i);
			await tick();
		}
		expect(halts.map((h) => h.name)).toEqual(["busy"]);
	});

	test("a recreated container (restart count back to zero) is not a death", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("s", 10)];
		const tick = createProcessorWatch(cfg(), deps());

		container = crashed(2);
		await tick();
		container = { ...crashed(0), exitCode: 0 };
		await tick();
		expect(halts).toEqual([]);
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

	test("deaths with the cursor creeping forward between them still count as one streak", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("dense", 5_000, "reindexing")];
		const tick = createProcessorWatch(cfg(), deps());

		await tick(); // baseline
		for (let i = 1; i <= MAX_RESTARTS_PER_HEIGHT; i++) {
			subgraphs[id] = [sub("dense", 5_000 + i * 100, "reindexing")];
			container = crashed(i);
			await tick();
		}

		expect(halts.map((h) => h.name)).toEqual(["dense"]);
	});

	test("a cursor that moves past the margin between deaths resets the streak", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("s", 5_000, "reindexing")];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		// Two deaths near 5,000, then it gets well past the margin and dies
		// twice more somewhere new: never three in one place.
		const cursors = [5_100, 5_200, 9_000, 9_100];
		for (const [i, cursor] of cursors.entries()) {
			subgraphs[id] = [sub("s", cursor, "reindexing")];
			container = crashed(i + 1);
			await tick();
		}

		expect(halts).toEqual([]);
	});

	test("an innocent subgraph whose cursor moves well past is never halted", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("innocent", 100)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		for (let i = 1; i <= MAX_RESTARTS_PER_HEIGHT * 2; i++) {
			subgraphs[id] = [sub("innocent", 100 + i * 5_000)];
			container = crashed(i);
			await tick();
		}

		expect(halts).toEqual([]);
	});

	test("a subgraph keeping up with the tip is never blamed for another's deaths", async () => {
		reset();
		const id = await seedTenant();
		subgraphs[id] = [sub("atTip", 999_900), sub("behind", 5_000, "reindexing")];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		for (let i = 1; i <= MAX_RESTARTS_PER_HEIGHT; i++) {
			// A follows the tip (+50 per tick, well inside the margin of it);
			// B is far behind and creeps +100 per attempt.
			subgraphs[id] = [
				sub("atTip", 999_900 + i * 50),
				sub("behind", 5_000 + i * 100, "reindexing"),
			];
			container = crashed(i);
			await tick();
		}

		expect(halts.map((h) => h.name)).toEqual(["behind"]);
	});

	test("with the tip unknown only a cursor that has not moved at all is blamed", async () => {
		reset();
		tip = null;
		const id = await seedTenant();
		subgraphs[id] = [sub("frozen", 5_000), sub("creeping", 8_000)];
		const tick = createProcessorWatch(cfg(), deps());

		await tick();
		for (let i = 1; i <= MAX_RESTARTS_PER_HEIGHT; i++) {
			subgraphs[id] = [sub("frozen", 5_000), sub("creeping", 8_000 + i * 10)];
			container = crashed(i);
			await tick();
		}

		expect(halts.map((h) => h.name)).toEqual(["frozen"]);
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
			subgraphs[id] = [sub("s", 20 + (round + 1) * 5_000)];
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
		tip = 1_000_200;
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
		tip = 1_000_200;
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

	test("inspects the processor container and parses restart count, OOM flag and exit code", async () => {
		const calls: string[][] = [];
		const d = realProcessorWatchDeps(base, {
			runDocker: async (args) => {
				calls.push(args);
				return {
					code: 0,
					stdout: "2 true 137 2026-10-06T10:00:00.123456789Z\n",
					stderr: "",
				};
			},
		});
		expect(await d.inspectProcessor("abcd1234")).toEqual({
			restartCount: 2,
			oomKilled: true,
			exitCode: 137,
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

	test("listing marks a reindex that is queued behind another operation", async () => {
		const d = realProcessorWatchDeps(base, {
			fetchImpl: (async (url: string) => {
				if (url.endsWith("/api/subgraphs")) {
					return Response.json({
						data: [
							{ name: "a", status: "reindexing", lastProcessedBlock: 0 },
							{ name: "b", status: "reindexing", lastProcessedBlock: 9 },
							{ name: "c", status: "active", lastProcessedBlock: 5 },
						],
					});
				}
				return Response.json(
					url.endsWith("/a")
						? { sync: { queue: { position: 1 } } }
						: { sync: {} },
				);
			}) as unknown as typeof fetch,
		});
		const rows = await d.listSubgraphs({
			baseUrl: "http://127.0.0.1:20001",
			instanceToken: "tok",
		});
		expect(rows.map((r) => [r.name, r.queued])).toEqual([
			["a", true],
			["b", false],
			["c", undefined],
		]);
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
