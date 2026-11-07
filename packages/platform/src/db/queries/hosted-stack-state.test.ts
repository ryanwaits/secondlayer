import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { balanceLevel } from "../../billing/runway.ts";
import {
	type HostedStackState,
	type HostedStackStopReason,
	type ServiceState,
	getServiceState,
	isBillingStop,
	legacyServiceState,
	serviceStateOf,
	upsertStackStates,
} from "./hosted-stack-state.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const accountIds: string[] = [];

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: true })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

afterAll(async () => {
	if (!HAS_DB || accountIds.length === 0) return;
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

const at = (iso: string) => new Date(iso);

describe("serviceStateOf", () => {
	const cases: Array<
		[
			HostedStackState | null,
			HostedStackStopReason | null,
			ServiceState,
			"running" | "stopped" | "none",
		]
	> = [
		[null, null, "none", "none"],
		["provisioning", null, "provisioning", "none"],
		["running", null, "running", "running"],
		["stopped", "credits", "stopped_credits", "stopped"],
		["stopped", "cap", "stopped_cap", "stopped"],
		["stopped", "idle", "stopped_idle", "stopped"],
		["destroyed", null, "none", "none"],
	];
	test.each(cases)(
		"%s / %s reads %s (old web state %s)",
		(state, reason, expected, legacy) => {
			const got = serviceStateOf(state ? { state, stop_reason: reason } : null);
			expect(got).toBe(expected);
			expect(legacyServiceState(got)).toBe(legacy);
		},
	);

	test("only credits and cap stops are billing stops", () => {
		expect(isBillingStop("stopped_credits")).toBe(true);
		expect(isBillingStop("stopped_cap")).toBe(true);
		for (const s of [
			"none",
			"provisioning",
			"running",
			"stopped_idle",
		] as const) {
			expect(isBillingStop(s)).toBe(false);
		}
	});

	test("the stopped balance level needs a billing stop and no balance", () => {
		const level = (serviceState: ServiceState, balanceUsdMicros: bigint) =>
			balanceLevel({
				serviceState,
				balanceUsdMicros,
				runwayDays: Number.POSITIVE_INFINITY,
			});
		expect(level("stopped_credits", 0n)).toBe("stopped");
		expect(level("stopped_cap", 0n)).toBe("stopped");
		expect(level("stopped_idle", 0n)).toBe("ok");
		expect(level("none", 0n)).toBe("ok");
		expect(level("stopped_credits", 1n)).toBe("ok");
	});
});

describe.skipIf(!HAS_DB)("upsertStackStates", () => {
	test("a report older than the stored one is ignored", async () => {
		const accountId = await makeAccount();
		const report = (
			state: HostedStackState,
			stopReason: HostedStackStopReason | null,
			observedAt: Date,
		) => ({ accountId, state, stopReason, observedAt });

		expect(
			await upsertStackStates(db, [
				report("running", null, at("2026-11-07T12:00:00Z")),
			]),
		).toBe(1);
		expect(
			await upsertStackStates(db, [
				report("stopped", "credits", at("2026-11-07T11:59:00Z")),
			]),
		).toBe(0);
		expect(await getServiceState(db, accountId)).toBe("running");

		expect(
			await upsertStackStates(db, [
				report("stopped", "cap", at("2026-11-07T12:01:00Z")),
			]),
		).toBe(1);
		expect(await getServiceState(db, accountId)).toBe("stopped_cap");
	});

	test("a repeat of the same observation is accepted", async () => {
		const accountId = await makeAccount();
		const report = {
			accountId,
			state: "running" as const,
			stopReason: null,
			observedAt: at("2026-11-07T12:00:00Z"),
		};
		await upsertStackStates(db, [report]);
		expect(await upsertStackStates(db, [report])).toBe(1);
	});

	test("within one batch the latest observation of an account wins", async () => {
		const accountId = await makeAccount();
		await upsertStackStates(db, [
			{
				accountId,
				state: "stopped",
				stopReason: "idle",
				observedAt: at("2026-11-07T12:05:00Z"),
			},
			{
				accountId,
				state: "running",
				stopReason: null,
				observedAt: at("2026-11-07T12:00:00Z"),
			},
		]);
		expect(await getServiceState(db, accountId)).toBe("stopped_idle");
	});

	test("an unknown account is skipped without failing the batch", async () => {
		const known = await makeAccount();
		const applied = await upsertStackStates(db, [
			{
				accountId: crypto.randomUUID(),
				state: "running",
				stopReason: null,
				observedAt: at("2026-11-07T12:00:00Z"),
			},
			{
				accountId: known,
				state: "provisioning",
				stopReason: null,
				observedAt: at("2026-11-07T12:00:00Z"),
			},
		]);
		expect(applied).toBe(1);
		expect(await getServiceState(db, known)).toBe("provisioning");
	});

	test("the table refuses a stop reason on a stack that is not stopped", async () => {
		const accountId = await makeAccount();
		await expect(
			upsertStackStates(db, [
				{
					accountId,
					state: "running",
					stopReason: "idle",
					observedAt: at("2026-11-07T12:00:00Z"),
				},
			]),
		).rejects.toThrow();
	});
});
