import { describe, expect, test } from "bun:test";
import {
	WAKE_IDLE,
	WAKE_TIMEOUT_MS,
	isStopped,
	noticeFor,
	stackStatus,
	wakeReducer,
} from "./stack-status";

const funded = "5000000";

describe("stackStatus", () => {
	test("is unknown until billing state or a read says something", () => {
		expect(
			stackStatus({ service: null, read: null, creditsUsdMicros: null }),
		).toBeNull();
	});

	test("an account with no stack is none, funded or not", () => {
		expect(
			stackStatus({ service: "none", read: null, creditsUsdMicros: "0" }),
		).toBe("none");
	});

	test("a running stack is running", () => {
		expect(
			stackStatus({ service: "running", read: null, creditsUsdMicros: funded }),
		).toBe("running");
	});

	test("a read that came back asleep is asleep even with no credits", () => {
		expect(
			stackStatus({
				service: "stopped",
				read: { kind: "asleep" },
				creditsUsdMicros: "0",
			}),
		).toBe("asleep");
	});

	test("an asleep stack the reader asked to wake is waking", () => {
		expect(
			stackStatus({
				service: "stopped",
				read: { kind: "asleep" },
				creditsUsdMicros: funded,
				waking: true,
			}),
		).toBe("waking");
	});

	test("a starting read beats a stale stopped state", () => {
		expect(
			stackStatus({
				service: "stopped",
				read: { kind: "starting" },
				creditsUsdMicros: funded,
			}),
		).toBe("starting");
	});

	test("a read refused for credits is stopped for credits", () => {
		expect(
			stackStatus({
				service: null,
				read: { kind: "no_credits" },
				creditsUsdMicros: null,
			}),
		).toBe("stopped_no_credits");
	});

	test("stopped at a zero balance is stopped for credits", () => {
		expect(
			stackStatus({ service: "stopped", read: null, creditsUsdMicros: "0" }),
		).toBe("stopped_no_credits");
	});

	test("stopped with credits and a read that got through restarts on its own", () => {
		expect(
			stackStatus({
				service: "stopped",
				read: { kind: "ok" },
				creditsUsdMicros: funded,
			}),
		).toBe("starting");
	});

	test("stopped with nothing else known says only that it is stopped", () => {
		expect(
			stackStatus({ service: "stopped", read: null, creditsUsdMicros: funded }),
		).toBe("stopped_other");
		expect(
			stackStatus({
				service: "stopped",
				read: { kind: "ok" },
				creditsUsdMicros: null,
			}),
		).toBe("stopped_other");
	});

	test("only the two stopped statuses count as stopped", () => {
		expect(isStopped("stopped_no_credits")).toBe(true);
		expect(isStopped("stopped_other")).toBe(true);
		expect(isStopped("asleep")).toBe(false);
		expect(isStopped("starting")).toBe(false);
		expect(isStopped(null)).toBe(false);
	});
});

describe("stackStatus from the reported stack", () => {
	const at = (
		stack: Parameters<typeof stackStatus>[0]["stack"],
		waking = false,
	) =>
		stackStatus({
			service: "stopped",
			stack,
			read: null,
			creditsUsdMicros: "5000000",
			waking,
		});

	test("each reported state maps to one status, whatever the legacy state says", () => {
		expect(at("none")).toBe("none");
		expect(at("provisioning")).toBe("starting");
		expect(at("running")).toBe("running");
		expect(at("stopped_credits")).toBe("stopped_no_credits");
		expect(at("stopped_cap")).toBe("stopped_other");
	});

	test("an idle stop is asleep, not stopped for credits, even at a zero balance", () => {
		expect(at("stopped_idle")).toBe("asleep");
		expect(at("stopped_idle", true)).toBe("waking");
		expect(
			stackStatus({
				service: "stopped",
				stack: "stopped_idle",
				read: null,
				creditsUsdMicros: "0",
			}),
		).toBe("asleep");
	});

	test("without the reported state the legacy state decides", () => {
		expect(at(undefined)).toBe("stopped_other");
	});
});

describe("noticeFor", () => {
	test("a good read and a missing list are no notice", () => {
		expect(noticeFor({ kind: "ok", data: [] })).toBeNull();
		expect(noticeFor({ kind: "not_found" })).toBeNull();
	});

	test("a rate limit leaves the notice as it is", () => {
		expect(noticeFor({ kind: "rate_limited", retryAfter: 5 })).toBeUndefined();
	});

	test("starting, asleep and no credits each become their own notice", () => {
		expect(noticeFor({ kind: "starting", retryAfter: 5 })).toEqual({
			kind: "starting",
		});
		expect(noticeFor({ kind: "asleep" })).toEqual({ kind: "asleep" });
		expect(noticeFor({ kind: "no_credits" })).toEqual({ kind: "no_credits" });
	});

	test("an error carries its message", () => {
		expect(noticeFor({ kind: "error", message: "boom" })).toEqual({
			kind: "error",
			message: "boom",
		});
	});
});

describe("wakeReducer", () => {
	test("start moves idle to waking and a second start keeps the first clock", () => {
		const first = wakeReducer(WAKE_IDLE, { type: "start", now: 1000 });
		expect(first).toEqual({ phase: "waking", since: 1000 });
		expect(wakeReducer(first, { type: "start", now: 9000 })).toBe(first);
	});

	test("a wake that never lands falls back to failed after the timeout", () => {
		const waking = wakeReducer(WAKE_IDLE, { type: "start", now: 0 });
		expect(
			wakeReducer(waking, { type: "tick", now: WAKE_TIMEOUT_MS - 1 }),
		).toBe(waking);
		const failed = wakeReducer(waking, { type: "tick", now: WAKE_TIMEOUT_MS });
		expect(failed.phase).toBe("failed");
	});

	test("a failed wake request carries its message, and waking again clears it", () => {
		const waking = wakeReducer(WAKE_IDLE, { type: "start", now: 0 });
		const failed = wakeReducer(waking, { type: "error", message: "nope" });
		expect(failed).toEqual({ phase: "failed", message: "nope" });
		expect(wakeReducer(failed, { type: "start", now: 5 })).toEqual({
			phase: "waking",
			since: 5,
		});
	});

	test("ticks and errors do nothing while idle", () => {
		expect(wakeReducer(WAKE_IDLE, { type: "tick", now: 99_999 })).toBe(
			WAKE_IDLE,
		);
		expect(wakeReducer(WAKE_IDLE, { type: "error", message: "x" })).toBe(
			WAKE_IDLE,
		);
	});
});
