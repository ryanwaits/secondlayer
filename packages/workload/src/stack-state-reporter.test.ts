import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HOSTED_STACK_STATES } from "@secondlayer/platform/db/queries/hosted-stack-state";
import { HOSTED_STACK_STOP_REASONS } from "@secondlayer/platform/db/queries/hosted-stack-state";
import postgres from "postgres";
import {
	STOP_REASONS,
	TENANT_STATES,
	acct8For,
	deleteTenant,
	ensureControlSchema,
	insertProvisioningTenant,
} from "./control-db.ts";
import {
	type StackStateReport,
	createStackStateReporter,
} from "./stack-state-reporter.ts";
import { forceTenantState } from "./tenant-fixture.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB
	? postgres(process.env.DATABASE_URL as string)
	: (null as never);

const platform = {
	appServerUrl: "https://app.example.com/",
	workloadHostKey: "k",
};
const ids: string[] = [];

async function tenant(
	state: (typeof TENANT_STATES)[number],
	reason?: (typeof STOP_REASONS)[number],
): Promise<string> {
	const accountId = crypto.randomUUID();
	await insertProvisioningTenant(db, accountId, acct8For(accountId));
	await forceTenantState(db, accountId, state, reason);
	ids.push(accountId);
	return accountId;
}

type Call = { url: string; headers: Headers; states: StackStateReport[] };

function harness(
	respond: (call: number) => Response = () => Response.json({}),
) {
	const calls: Call[] = [];
	const fetchImpl = async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		calls.push({
			url: String(input),
			headers: new Headers(init?.headers),
			states: JSON.parse(String(init?.body)).states,
		});
		return respond(calls.length);
	};
	return { calls, fetchImpl };
}

const mine = (c: Call) => c.states.filter((s) => ids.includes(s.account_id));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("platform and workload state lists", () => {
	test("tenant states and stop reasons match what the platform accepts", () => {
		expect([...TENANT_STATES]).toEqual([...HOSTED_STACK_STATES]);
		expect([...STOP_REASONS]).toEqual([...HOSTED_STACK_STOP_REASONS]);
	});
});

describe.skipIf(!HAS_DB)("stack state reporter", () => {
	beforeAll(async () => {
		await ensureControlSchema(db);
	});

	afterAll(async () => {
		for (const id of ids) await deleteTenant(db, id);
		await db.end();
	});

	test("reconcile reports every tenant with its state and stop reason", async () => {
		const running = await tenant("running");
		const credits = await tenant("stopped", "credits");
		const idle = await tenant("stopped", "idle");
		const { calls, fetchImpl } = harness();
		const reporter = createStackStateReporter(db, platform, { fetchImpl });

		expect(await reporter.reconcile()).toBe(true);

		expect(calls[0]?.url).toBe("https://app.example.com/internal/stack-state");
		expect(calls[0]?.headers.get("authorization")).toBe("Bearer k");
		const byId = new Map(calls.flatMap(mine).map((s) => [s.account_id, s]));
		expect(byId.get(running)).toMatchObject({
			state: "running",
			stop_reason: null,
		});
		expect(byId.get(credits)).toMatchObject({
			state: "stopped",
			stop_reason: "credits",
		});
		expect(byId.get(idle)).toMatchObject({
			state: "stopped",
			stop_reason: "idle",
		});
	});

	test("a failed post is logged, returns false, and the next reconcile sends the same state", async () => {
		const accountId = await tenant("stopped", "cap");
		const { calls, fetchImpl } = harness((n) =>
			n === 1 ? new Response("boom", { status: 500 }) : Response.json({}),
		);
		const reporter = createStackStateReporter(db, platform, { fetchImpl });

		expect(await reporter.reconcile()).toBe(false);
		expect(await reporter.reconcile()).toBe(true);

		expect(calls).toHaveLength(2);
		for (const call of calls) {
			expect(call.states.filter((s) => s.account_id === accountId)).toEqual([
				expect.objectContaining({
					account_id: accountId,
					state: "stopped",
					stop_reason: "cap",
				}),
			]);
		}
	});

	test("a network error never throws out of the reporter", async () => {
		await tenant("running");
		const reporter = createStackStateReporter(db, platform, {
			fetchImpl: async () => {
				throw new Error("connection refused");
			},
		});
		expect(await reporter.reconcile()).toBe(false);
	});

	test("rapid changes to one account send a single report with the final row", async () => {
		const accountId = await tenant("running");
		const { calls, fetchImpl } = harness();
		const reporter = createStackStateReporter(db, platform, {
			fetchImpl,
			debounceMs: 30,
		});

		reporter.schedule(accountId);
		await forceTenantState(db, accountId, "stopped", "idle");
		reporter.schedule(accountId);
		reporter.schedule(accountId);
		await wait(120);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.states).toEqual([
			expect.objectContaining({
				account_id: accountId,
				state: "stopped",
				stop_reason: "idle",
			}),
		]);
	});

	test("different accounts are debounced independently", async () => {
		const a = await tenant("running");
		const b = await tenant("running");
		const { calls, fetchImpl } = harness();
		const reporter = createStackStateReporter(db, platform, {
			fetchImpl,
			debounceMs: 20,
		});

		reporter.schedule(a);
		reporter.schedule(b);
		await wait(100);

		expect(calls.map((c) => c.states[0]?.account_id).sort()).toEqual(
			[a, b].sort(),
		);
	});

	test("stop cancels a pending report", async () => {
		const accountId = await tenant("running");
		const { calls, fetchImpl } = harness();
		const reporter = createStackStateReporter(db, platform, {
			fetchImpl,
			debounceMs: 20,
		});

		reporter.schedule(accountId);
		reporter.stop();
		await wait(80);

		expect(calls).toHaveLength(0);
	});

	test("an account whose row is gone reports as destroyed", async () => {
		const accountId = crypto.randomUUID();
		const { calls, fetchImpl } = harness();
		const reporter = createStackStateReporter(db, platform, {
			fetchImpl,
			debounceMs: 10,
		});

		reporter.schedule(accountId);
		await wait(80);

		expect(calls[0]?.states).toEqual([
			expect.objectContaining({
				account_id: accountId,
				state: "destroyed",
				stop_reason: null,
			}),
		]);
	});
});
