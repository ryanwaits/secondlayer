import { describe, expect, spyOn, test } from "bun:test";
import { logger } from "@secondlayer/shared";
import type { FailedRequestRecord } from "@secondlayer/shared/error-envelope";
import { createFailedRequestRecorder } from "./failed-requests.ts";

function row(n: number): FailedRequestRecord {
	return {
		request_id: `req_${String(n).padStart(8, "0")}`,
		account_id: "00000000-0000-4000-8000-000000000001",
		method: "GET",
		path: "/v1/subgraphs/s/t",
		status: 400,
		code: "VALIDATION_ERROR",
		message: "bad",
		query: {},
		origin: null,
	};
}

type Call = { url: string; auth: string | null; ids: string[] };

function stub(status = 200) {
	const calls: Call[] = [];
	const fetchImpl = async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const body = JSON.parse(String(init?.body)) as {
			items: FailedRequestRecord[];
		};
		calls.push({
			url: String(input),
			auth: new Headers(init?.headers).get("authorization"),
			ids: body.items.map((i) => i.request_id),
		});
		return new Response("{}", { status });
	};
	return { calls, fetchImpl };
}

const base = { appServerUrl: "https://app.test/", workloadHostKey: "wh-key" };

describe("failed request recorder", () => {
	test("flush posts to the internal route in batches of maxBatch", async () => {
		const { calls, fetchImpl } = stub();
		const r = createFailedRequestRecorder({ ...base, fetchImpl, maxBatch: 2 });
		r.record(row(0));
		expect(r.size()).toBe(1);
		r.record(row(1));
		r.record(row(2));
		await r.flush();
		expect(r.size()).toBe(0);
		for (const c of calls) {
			expect(c.url).toBe("https://app.test/internal/failed-requests");
			expect(c.auth).toBe("Bearer wh-key");
			expect(c.ids.length).toBeLessThanOrEqual(2);
		}
		expect(calls.flatMap((c) => c.ids)).toEqual(
			[row(0), row(1), row(2)].map((x) => x.request_id),
		);
	});

	test("reaching maxBatch flushes in the background", async () => {
		const { calls, fetchImpl } = stub();
		const r = createFailedRequestRecorder({ ...base, fetchImpl, maxBatch: 3 });
		for (let i = 0; i < 3; i++) r.record(row(i));
		await r.flush();
		expect(calls.flatMap((c) => c.ids).length).toBe(3);
	});

	test("overflow drops the oldest row", async () => {
		const { calls, fetchImpl } = stub();
		const r = createFailedRequestRecorder({
			...base,
			fetchImpl,
			maxBatch: 100,
			maxBuffer: 3,
		});
		for (let i = 0; i < 5; i++) r.record(row(i));
		expect(r.size()).toBe(3);
		await r.flush();
		expect(calls[0]?.ids).toEqual(
			[row(2), row(3), row(4)].map((x) => x.request_id),
		);
	});

	test("a non-2xx flush drops the batch, does not throw, warns once per minute", async () => {
		const { calls, fetchImpl } = stub(500);
		const warn = spyOn(logger, "warn").mockImplementation(() => {});
		let t = 0;
		const r = createFailedRequestRecorder({
			...base,
			fetchImpl,
			maxBatch: 100,
			now: () => t,
		});
		r.record(row(1));
		await r.flush();
		expect(r.size()).toBe(0);
		expect(calls.length).toBe(1);
		t = 1000;
		r.record(row(2));
		await r.flush();
		expect(warn).toHaveBeenCalledTimes(1);
		t = 61_000;
		r.record(row(3));
		await r.flush();
		expect(warn).toHaveBeenCalledTimes(2);
		warn.mockRestore();
	});

	test("a thrown fetch is swallowed", async () => {
		const r = createFailedRequestRecorder({
			...base,
			fetchImpl: async () => {
				throw new Error("down");
			},
		});
		r.record(row(1));
		await expect(r.flush()).resolves.toBeUndefined();
		expect(r.size()).toBe(0);
	});

	test("stop performs a final flush", async () => {
		const { calls, fetchImpl } = stub();
		const r = createFailedRequestRecorder({
			...base,
			fetchImpl,
			flushIntervalMs: 60_000,
		});
		const stop = r.start();
		r.record(row(1));
		await stop();
		expect(calls.flatMap((c) => c.ids)).toEqual([row(1).request_id]);
	});
});
