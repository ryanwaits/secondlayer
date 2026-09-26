import { describe, expect, test } from "bun:test";
import type { DoctorIssue } from "@secondlayer/sdk";
import { countByDisplayStatus, displayStatus } from "./shared";

function issue(overrides: Partial<DoctorIssue> = {}): DoctorIssue {
	return { code: "receiver_down", severity: "bad", ...overrides };
}

describe("displayStatus", () => {
	test("active with no issues is Delivering", () => {
		expect(
			displayStatus({
				status: "active",
				circuitOpenedAt: null,
				circuitFailures: 0,
			}),
		).toBe("active");
	});

	test("paused by the user (no circuit) stays Paused, even with failures", () => {
		expect(
			displayStatus({
				status: "paused",
				circuitOpenedAt: null,
				circuitFailures: 3,
			}),
		).toBe("paused");
	});

	test("paused with the circuit open is Failing, not Paused", () => {
		expect(
			displayStatus({
				status: "paused",
				circuitOpenedAt: "2026-04-23T00:00:00.000Z",
				circuitFailures: 20,
			}),
		).toBe("error");
	});

	test("active with 4 consecutive failures is still Delivering", () => {
		expect(
			displayStatus({
				status: "active",
				circuitOpenedAt: null,
				circuitFailures: 4,
			}),
		).toBe("active");
	});

	test("active with 5 consecutive failures is Failing", () => {
		expect(
			displayStatus({
				status: "active",
				circuitOpenedAt: null,
				circuitFailures: 5,
			}),
		).toBe("error");
	});

	for (const code of [
		"receiver_down",
		"receiver_rejects",
		"circuit",
	] as const) {
		test(`a primary "bad" ${code} is Failing`, () => {
			expect(
				displayStatus(
					{ status: "active", circuitOpenedAt: null, circuitFailures: 0 },
					issue({ code, severity: "bad" }),
				),
			).toBe("error");
		});
	}

	test("a primary bad issue outside the failing set stays Delivering", () => {
		expect(
			displayStatus(
				{ status: "active", circuitOpenedAt: null, circuitFailures: 0 },
				issue({ code: "dead_letters", severity: "bad" }),
			),
		).toBe("active");
	});

	test("a warn-severity receiver_down doesn't count — severity must be bad", () => {
		expect(
			displayStatus(
				{ status: "active", circuitOpenedAt: null, circuitFailures: 0 },
				issue({ code: "receiver_down", severity: "warn" }),
			),
		).toBe("active");
	});

	test("paused still wins over a bad primary issue (rule order: paused checked first)", () => {
		expect(
			displayStatus(
				{ status: "paused", circuitOpenedAt: null, circuitFailures: 0 },
				issue({ code: "receiver_down", severity: "bad" }),
			),
		).toBe("paused");
	});

	test("null primary is the same as no primary", () => {
		expect(
			displayStatus(
				{ status: "active", circuitOpenedAt: null, circuitFailures: 0 },
				null,
			),
		).toBe("active");
	});
});

describe("countByDisplayStatus", () => {
	// The list page's rows, in WebhookSummary's shape (no primary): one
	// auto-paused by the breaker, one active but failing 5 in a row, one
	// healthy, one paused by the user.
	const rows = [
		{
			status: "paused" as const,
			circuitOpenedAt: "2026-04-23T00:00:00.000Z",
			circuitFailures: 20,
		},
		{ status: "active" as const, circuitOpenedAt: null, circuitFailures: 5 },
		{ status: "active" as const, circuitOpenedAt: null, circuitFailures: 0 },
		{ status: "paused" as const, circuitOpenedAt: null, circuitFailures: 0 },
	];

	test("counts circuit-paused and 5-in-a-row failing rows as error (Needs attention)", () => {
		expect(countByDisplayStatus(rows, "error")).toBe(2);
	});

	test("counts only the genuinely active row as Delivering", () => {
		expect(countByDisplayStatus(rows, "active")).toBe(1);
	});

	test("counts the user-paused row as paused", () => {
		expect(countByDisplayStatus(rows, "paused")).toBe(1);
	});

	test("an empty list counts zero for every status", () => {
		expect(countByDisplayStatus([], "error")).toBe(0);
		expect(countByDisplayStatus([], "active")).toBe(0);
	});
});
