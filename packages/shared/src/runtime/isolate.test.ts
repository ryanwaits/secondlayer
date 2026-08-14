import { describe, expect, test } from "bun:test";
import {
	IsolationKillError,
	IsolationOomError,
	isolateHandler,
} from "./isolate.ts";

describe("handler isolation", () => {
	test("a throw is contained; host stays alive", async () => {
		const result = await isolateHandler(
			async () => {
				throw new Error("handler boom");
			},
			{ timeoutMs: 50 },
		);
		expect(result).toEqual({
			ok: false,
			fault: "throw",
			hostAlive: true,
			detail: "handler boom",
		});
	});

	test("an infinite loop hits the timeout and cannot kill ingest", async () => {
		const result = await isolateHandler(
			async ({ signal }) => {
				while (!signal.aborted) {
					await new Promise((resolve) => setTimeout(resolve, 5));
				}
				const err = new Error("aborted");
				err.name = "AbortError";
				throw err;
			},
			{ timeoutMs: 20 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.fault).toBe("timeout");
		expect(result.hostAlive).toBe(true);
	});

	test("process-kill and oom fixtures cannot take the host down", async () => {
		const killed = await isolateHandler(
			async () => {
				throw new IsolationKillError("worker SIGKILL");
			},
			{ timeoutMs: 50 },
		);
		expect(killed.ok).toBe(false);
		if (!killed.ok) expect(killed.fault).toBe("kill");
		const oom = await isolateHandler(
			async () => {
				throw new IsolationOomError("heap limit");
			},
			{ timeoutMs: 50 },
		);
		expect(oom.ok).toBe(false);
		if (!oom.ok) expect(oom.fault).toBe("oom");
		expect(killed.hostAlive && oom.hostAlive).toBe(true);
	});

	test("network is denied unless allowNetwork", async () => {
		const denied = await isolateHandler(
			async ({ fetch }) => {
				await fetch("https://example.com");
			},
			{ timeoutMs: 50 },
		);
		expect(denied.ok).toBe(false);
		if (!denied.ok) expect(denied.fault).toBe("network");
	});
});
