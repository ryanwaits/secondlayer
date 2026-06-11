import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@secondlayer/shared";
import type { Kysely } from "kysely";
import {
	clampDeployStartBlock,
	resolveGenesisPolicy,
	resolvePrivateVisibilityPolicy,
	resolveSubscriptionQuota,
} from "./plan-limits.ts";

/** Minimal accounts-table stub: `SELECT plan FROM accounts WHERE id = …`. */
function dbWithPlan(plan: string | undefined): Kysely<Database> {
	return {
		selectFrom: () => ({
			select: () => ({
				where: () => ({
					executeTakeFirst: async () => (plan ? { plan } : undefined),
				}),
			}),
		}),
	} as unknown as Kysely<Database>;
}

describe("plan-limit policies (platform mode)", () => {
	let prevMode: string | undefined;
	let prevExempt: string | undefined;

	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
		prevExempt = process.env.SUBGRAPH_GENESIS_EXEMPT_ACCOUNT_IDS;
		process.env.INSTANCE_MODE = "platform";
		delete process.env.SUBGRAPH_GENESIS_EXEMPT_ACCOUNT_IDS;
	});
	afterEach(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
		if (prevExempt === undefined)
			delete process.env.SUBGRAPH_GENESIS_EXEMPT_ACCOUNT_IDS;
		else process.env.SUBGRAPH_GENESIS_EXEMPT_ACCOUNT_IDS = prevExempt;
	});

	test("free plan (none) cannot go private", async () => {
		const policy = await resolvePrivateVisibilityPolicy(
			dbWithPlan("none"),
			"acct_free",
		);
		expect(policy.privateAllowed).toBe(false);
	});

	test("missing account row (ghosts) cannot go private", async () => {
		const policy = await resolvePrivateVisibilityPolicy(
			dbWithPlan(undefined),
			"acct_ghost",
		);
		expect(policy.privateAllowed).toBe(false);
	});

	test("paid plan can go private", async () => {
		const policy = await resolvePrivateVisibilityPolicy(
			dbWithPlan("launch"),
			"acct_pro",
		);
		expect(policy).toEqual({ privateAllowed: true, reason: "paid-plan" });
	});

	test("exempt account can go private regardless of plan", async () => {
		process.env.SUBGRAPH_GENESIS_EXEMPT_ACCOUNT_IDS = "acct_seed";
		const policy = await resolvePrivateVisibilityPolicy(
			dbWithPlan("none"),
			"acct_seed",
		);
		expect(policy).toEqual({ privateAllowed: true, reason: "exempt-account" });
	});

	test("non-platform mode never gates", async () => {
		process.env.INSTANCE_MODE = "oss";
		const policy = await resolvePrivateVisibilityPolicy(
			dbWithPlan("none"),
			"anyone",
		);
		expect(policy).toEqual({ privateAllowed: true, reason: "non-platform" });
	});

	test("genesis policy mirrors the same plan gate", async () => {
		expect(
			(await resolveGenesisPolicy(dbWithPlan("none"), "acct_free"))
				.genesisAllowed,
		).toBe(false);
		expect(
			(await resolveGenesisPolicy(dbWithPlan("launch"), "acct_pro"))
				.genesisAllowed,
		).toBe(true);
	});
});

describe("clampDeployStartBlock", () => {
	test("genesis allowed passes the request through", () => {
		expect(
			clampDeployStartBlock({
				genesisAllowed: true,
				requested: 1,
				existingStartBlock: undefined,
				chainTip: 1000,
			}),
		).toEqual({ startBlock: 1, clamped: false });
	});

	test("clamped new deploy is forward-only from tip", () => {
		expect(
			clampDeployStartBlock({
				genesisAllowed: false,
				requested: 1,
				existingStartBlock: undefined,
				chainTip: 1000,
			}),
		).toEqual({ startBlock: 1000, clamped: true });
	});

	test("clamped redeploy never moves history backward", () => {
		expect(
			clampDeployStartBlock({
				genesisAllowed: false,
				requested: 5,
				existingStartBlock: 500,
				chainTip: 1000,
			}),
		).toEqual({ startBlock: 500, clamped: true });
	});
});

describe("resolveSubscriptionQuota", () => {
	let prevMode: string | undefined;
	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
	});
	afterEach(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	test("free plan gets 3, pro gets 25, scale unlimited", async () => {
		expect(await resolveSubscriptionQuota(dbWithPlan("none"), "a")).toBe(3);
		expect(await resolveSubscriptionQuota(dbWithPlan("launch"), "a")).toBe(25);
		expect(await resolveSubscriptionQuota(dbWithPlan("scale"), "a")).toBeNull();
		expect(
			await resolveSubscriptionQuota(dbWithPlan("enterprise"), "a"),
		).toBeNull();
	});

	test("non-platform mode is unlimited", async () => {
		process.env.INSTANCE_MODE = "oss";
		expect(await resolveSubscriptionQuota(dbWithPlan("none"), "a")).toBeNull();
	});
});
