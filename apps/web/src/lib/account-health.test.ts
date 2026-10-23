import { describe, expect, test } from "bun:test";
import type { WebhookSummary } from "@secondlayer/sdk";
import type { Billing, Caps } from "./account-data";
import {
	type HealthInput,
	accountProblems,
	daysLeft,
	daysLeftLabel,
} from "./account-health";
import type { Burn, HostedStack } from "./usage";

const usd = (dollars: number) => String(Math.round(dollars * 1_000_000));
const billing = (dollars: number): Billing => ({
	creditsUsdMicros: usd(dollars),
	spentThisMonthUsdMicros: "0",
});
const burn = (perDay: number): Burn => ({
	rateDayUsdMicros: usd(perDay),
	windowHours: 24,
});
const stack = (state: HostedStack["state"]): HostedStack => ({
	state,
	lastChargedAt: null,
	memory24h: [],
});
const caps = (frozenAt: string | null): Caps => ({
	monthlyCapCents: 1000,
	alertThresholdPct: 80,
	frozenAt,
	alertSentAt: null,
});
const hook = (over: Partial<WebhookSummary>): WebhookSummary =>
	({
		id: "wh_1",
		name: "hook",
		status: "active",
		circuitOpenedAt: null,
		circuitFailures: 0,
		...over,
	}) as WebhookSummary;

const healthy: HealthInput = {
	billing: billing(29.62),
	burn: burn(0.35),
	service: stack("running"),
	caps: caps(null),
	webhooks: [hook({})],
};

describe("accountProblems", () => {
	test("a funded, running account with delivering webhooks has no problems", () => {
		expect(accountProblems(healthy)).toEqual([]);
	});

	test("nothing loaded yet reports no problems instead of guessing", () => {
		expect(
			accountProblems({
				billing: null,
				burn: null,
				service: null,
				caps: null,
				webhooks: null,
			}),
		).toEqual([]);
	});

	test("under 2 days of burn left is a low balance", () => {
		const problems = accountProblems({
			...healthy,
			billing: billing(0.5),
			burn: burn(0.35),
		});
		expect(problems.map((p) => p.kind)).toEqual(["low_balance"]);
		expect(problems[0]?.href).toBe("/account#usage");
	});

	test("exactly 2 days of burn left is still fine", () => {
		expect(
			accountProblems({ ...healthy, billing: billing(0.7), burn: burn(0.35) }),
		).toEqual([]);
	});

	test("a zero balance is a problem even when nothing is burning", () => {
		const problems = accountProblems({
			...healthy,
			billing: billing(0),
			burn: burn(0),
		});
		expect(problems.map((p) => p.kind)).toEqual(["low_balance"]);
	});

	test("a new account at zero balance with nothing running or burning is fine", () => {
		expect(
			accountProblems({
				...healthy,
				billing: billing(0),
				burn: burn(0),
				service: stack("none"),
			}),
		).toEqual([]);
	});

	test("a stopped stack at zero balance is one problem, not two", () => {
		const problems = accountProblems({
			...healthy,
			billing: billing(0),
			service: stack("stopped"),
		});
		expect(problems.map((p) => p.kind)).toEqual(["low_balance"]);
		expect(problems[0]?.label).toContain("stopped");
	});

	test("a stopped stack with money in the account is its own problem", () => {
		const problems = accountProblems({ ...healthy, service: stack("stopped") });
		expect(problems.map((p) => p.kind)).toEqual(["stack_stopped"]);
	});

	test("a stack that never ran is not a problem", () => {
		expect(accountProblems({ ...healthy, service: stack("none") })).toEqual([]);
	});

	test("a frozen spend cap links to the cap setting", () => {
		const problems = accountProblems({
			...healthy,
			caps: caps("2026-10-01T00:00:00Z"),
		});
		expect(problems.map((p) => p.kind)).toEqual(["cap_frozen"]);
		expect(problems[0]?.href).toBe("/account#cap");
	});

	test("failing webhooks are counted and link to the list", () => {
		const problems = accountProblems({
			...healthy,
			webhooks: [
				hook({}),
				hook({ id: "b", circuitFailures: 50 }),
				hook({ id: "c", status: "paused", circuitOpenedAt: "2026-10-01" }),
			],
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]?.kind).toBe("webhook_failing");
		expect(problems[0]?.label).toBe("2 webhooks need attention");
		expect(problems[0]?.href).toBe("/account#webhooks");
	});

	test("a user-paused webhook is not a problem", () => {
		expect(
			accountProblems({ ...healthy, webhooks: [hook({ status: "paused" })] }),
		).toEqual([]);
	});
});

describe("daysLeft", () => {
	test("is unknown until balance and burn have both loaded", () => {
		expect(daysLeft(null, burn(1))).toBeNull();
		expect(daysLeft(billing(1), null)).toBeNull();
	});

	test("divides balance by the daily burn", () => {
		expect(daysLeft(billing(10), burn(2))).toBe(5);
	});

	test("is infinite when nothing is burning", () => {
		expect(daysLeft(billing(10), burn(0))).toBe(Number.POSITIVE_INFINITY);
	});
});

describe("daysLeftLabel", () => {
	test("rounds down to whole days and singularizes", () => {
		expect(daysLeftLabel(86.4)).toBe("about 86 days");
		expect(daysLeftLabel(1.2)).toBe("about 1 day");
		expect(daysLeftLabel(0.4)).toBe("under a day");
	});

	test("has no label when unknown or not burning", () => {
		expect(daysLeftLabel(null)).toBeNull();
		expect(daysLeftLabel(Number.POSITIVE_INFINITY)).toBeNull();
	});
});
