import { describe, expect, test } from "bun:test";
import type { DoctorIssue } from "@secondlayer/sdk";
import { displayStatus } from "./shared";

function issue(overrides: Partial<DoctorIssue> = {}): DoctorIssue {
	return { code: "receiver_down", severity: "bad", ...overrides };
}

describe("displayStatus", () => {
	test("active with no issues is Delivering", () => {
		expect(displayStatus({ status: "active", circuitOpenedAt: null })).toBe(
			"active",
		);
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

	test("circuitFailures absent (the list page's WebhookSummary) never trips rule 3", () => {
		expect(displayStatus({ status: "active", circuitOpenedAt: null })).toBe(
			"active",
		);
	});

	for (const code of [
		"receiver_down",
		"receiver_rejects",
		"circuit",
	] as const) {
		test(`a primary "bad" ${code} is Failing`, () => {
			expect(
				displayStatus(
					{ status: "active", circuitOpenedAt: null },
					issue({ code, severity: "bad" }),
				),
			).toBe("error");
		});
	}

	test("a primary bad issue outside the failing set stays Delivering", () => {
		expect(
			displayStatus(
				{ status: "active", circuitOpenedAt: null },
				issue({ code: "dead_letters", severity: "bad" }),
			),
		).toBe("active");
	});

	test("a warn-severity receiver_down doesn't count — severity must be bad", () => {
		expect(
			displayStatus(
				{ status: "active", circuitOpenedAt: null },
				issue({ code: "receiver_down", severity: "warn" }),
			),
		).toBe("active");
	});

	test("paused still wins over a bad primary issue (rule order: paused checked first)", () => {
		expect(
			displayStatus(
				{ status: "paused", circuitOpenedAt: null },
				issue({ code: "receiver_down", severity: "bad" }),
			),
		).toBe("paused");
	});

	test("null primary is the same as no primary", () => {
		expect(
			displayStatus({ status: "active", circuitOpenedAt: null }, null),
		).toBe("active");
	});
});
