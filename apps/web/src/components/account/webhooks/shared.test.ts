import { describe, expect, test } from "bun:test";
import type { DoctorIssue } from "@secondlayer/sdk";
import {
	countByDisplayStatus,
	displayStatus,
	formatEventCell,
	isPaused,
	shortenName,
} from "./shared";

const NOW = Date.parse("2026-11-07T12:00:00.000Z");
const HOUR = 3_600_000;

function issue(overrides: Partial<DoctorIssue> = {}): DoctorIssue {
	return { code: "receiver_down", severity: "bad", ...overrides };
}

/** A webhook summary's state fields; `lastSuccessHoursAgo` sets how long the
 *  receiver has been silent. */
function hook(
	overrides: Partial<Parameters<typeof displayStatus>[0]> & {
		lastSuccessHoursAgo?: number;
	} = {},
) {
	const { lastSuccessHoursAgo = 0, ...rest } = overrides;
	return {
		status: "active",
		pauseReason: null,
		circuitOpenedAt: null,
		circuitFailures: 0,
		lastSuccessAt: new Date(NOW - lastSuccessHoursAgo * HOUR).toISOString(),
		createdAt: "2026-01-01T00:00:00.000Z",
		...rest,
	};
}

describe("isPaused", () => {
	test("is true for a paused webhook whoever paused it", () => {
		expect(isPaused({ status: "paused" })).toBe(true);
	});

	test("is false for a failing but active webhook", () => {
		expect(isPaused({ status: "active" })).toBe(false);
	});
});

describe("displayStatus", () => {
	test("the server's verdict wins over the browser clock", () => {
		// Silent for two days with 10 failures reads "down" from the clock, but
		// the server says ok: the pill shows what the server said.
		const stale = hook({ circuitFailures: 10, lastSuccessHoursAgo: 48 });
		expect(displayStatus(stale, null, NOW)).toBe("error");
		expect(displayStatus({ ...stale, health: "ok" }, null, NOW)).toBe("active");
	});

	test("a server verdict of down shows failing even when the clock sees fresh deliveries", () => {
		expect(displayStatus({ ...hook(), health: "down" }, null, NOW)).toBe(
			"error",
		);
	});

	test("a server verdict of paused_user shows paused", () => {
		expect(displayStatus({ ...hook(), health: "paused_user" }, null, NOW)).toBe(
			"paused",
		);
	});

	test("active with no failures is Delivering", () => {
		expect(displayStatus(hook(), null, NOW)).toBe("active");
	});

	test("paused by the user stays Paused, even with failures", () => {
		expect(
			displayStatus(
				hook({ status: "paused", pauseReason: "user", circuitFailures: 3 }),
				null,
				NOW,
			),
		).toBe("paused");
	});

	test("paused by the circuit breaker is Failing, not Paused", () => {
		expect(
			displayStatus(
				hook({
					status: "paused",
					pauseReason: "circuit",
					circuitOpenedAt: "2026-04-23T00:00:00.000Z",
					circuitFailures: 20,
				}),
				null,
				NOW,
			),
		).toBe("error");
	});

	test("a pause with no reason from an older API reads the circuit timestamp", () => {
		expect(
			displayStatus(
				hook({
					status: "paused",
					circuitOpenedAt: "2026-04-23T00:00:00.000Z",
				}),
				null,
				NOW,
			),
		).toBe("error");
		expect(displayStatus(hook({ status: "paused" }), null, NOW)).toBe("paused");
	});

	test("a few failures in a row is still Delivering", () => {
		expect(
			displayStatus(
				hook({ circuitFailures: 4, lastSuccessHoursAgo: 3 }),
				null,
				NOW,
			),
		).toBe("active");
	});

	test("5 failures in a row with no success for over 15 minutes is Failing", () => {
		expect(
			displayStatus(
				hook({ circuitFailures: 5, lastSuccessHoursAgo: 1 }),
				null,
				NOW,
			),
		).toBe("error");
	});

	test("5 failures in a row that only just started is not yet Failing", () => {
		expect(
			displayStatus(
				hook({ circuitFailures: 5, lastSuccessHoursAgo: 0 }),
				null,
				NOW,
			),
		).toBe("active");
	});

	for (const code of [
		"receiver_down",
		"receiver_rejects",
		"circuit",
	] as const) {
		test(`a primary "bad" ${code} is Failing`, () => {
			expect(displayStatus(hook(), issue({ code, severity: "bad" }), NOW)).toBe(
				"error",
			);
		});
	}

	test("a primary bad issue outside the failing set stays Delivering", () => {
		expect(
			displayStatus(
				hook(),
				issue({ code: "dead_letters", severity: "bad" }),
				NOW,
			),
		).toBe("active");
	});

	test("a warn-severity receiver_down doesn't count; severity must be bad", () => {
		expect(
			displayStatus(
				hook(),
				issue({ code: "receiver_down", severity: "warn" }),
				NOW,
			),
		).toBe("active");
	});

	test("a manual pause wins over a bad primary issue", () => {
		expect(
			displayStatus(
				hook({ status: "paused", pauseReason: "user" }),
				issue({ code: "receiver_down", severity: "bad" }),
				NOW,
			),
		).toBe("paused");
	});
});

describe("countByDisplayStatus", () => {
	// The list page's rows (no primary): one paused by the breaker, one active
	// and down, one healthy, one paused by the user.
	const rows = [
		hook({
			status: "paused",
			pauseReason: "circuit",
			circuitOpenedAt: "2026-04-23T00:00:00.000Z",
			circuitFailures: 20,
		}),
		hook({ circuitFailures: 5, lastSuccessHoursAgo: 2 }),
		hook(),
		hook({ status: "paused", pauseReason: "user" }),
	];

	test("counts circuit-paused and down rows as error (Needs attention)", () => {
		expect(countByDisplayStatus(rows, "error", NOW)).toBe(2);
	});

	test("counts only the genuinely active row as Delivering", () => {
		expect(countByDisplayStatus(rows, "active", NOW)).toBe(1);
	});

	test("counts the user-paused row as paused", () => {
		expect(countByDisplayStatus(rows, "paused", NOW)).toBe(1);
	});

	test("an empty list counts zero for every status", () => {
		expect(countByDisplayStatus([], "error", NOW)).toBe(0);
		expect(countByDisplayStatus([], "active", NOW)).toBe(0);
	});
});

describe("formatEventCell", () => {
	test("shortens the tx id and appends the event index", () => {
		expect(
			formatEventCell(
				"0x920af4720020f5aba341630e8965851f8537bc8fc99a856091093780c886a2c77",
				408,
			),
		).toBe("0x920a…2c77 #408");
	});

	test("no tx id (a test delivery, or a compacted outbox row) reads as a dash", () => {
		expect(formatEventCell(null, null)).toBe("–");
		expect(formatEventCell(null, 3)).toBe("–");
	});

	test("a tx id with no event index (neither rowIndex nor event_index shape) omits the #", () => {
		expect(formatEventCell("0xabc", null)).toBe("0xabc");
	});

	test("event index 0 still shows — it's a real position, not a missing value", () => {
		expect(formatEventCell("0xabc", 0)).toBe("0xabc #0");
	});
});

describe("shortenName", () => {
	test("shortens every Stacks address in a Sentinel-made name", () => {
		expect(
			shortenName(
				"sentinel:SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc:~dea842652e52db77",
			),
		).toBe("sentinel:SP1A27…ADJ7.v0-vault-sbtc:~dea842652e52db77");
	});

	test("leaves a plain name alone", () => {
		expect(shortenName("sbtc-deposits")).toBe("sbtc-deposits");
	});
});
