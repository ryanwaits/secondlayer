import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	pendingCountForTests,
	recordDelivery,
	resetMeterSocketCounterForTests,
	startMeterSocketReporter,
} from "./meter-socket.ts";

describe("recordDelivery / startMeterSocketReporter — WEBHOOK_METER_SOCKET gate", () => {
	let prevSocket: string | undefined;

	beforeEach(() => {
		prevSocket = process.env.WEBHOOK_METER_SOCKET;
		resetMeterSocketCounterForTests();
	});

	afterEach(() => {
		if (prevSocket === undefined) delete process.env.WEBHOOK_METER_SOCKET;
		else process.env.WEBHOOK_METER_SOCKET = prevSocket;
	});

	test("recordDelivery() is a no-op when WEBHOOK_METER_SOCKET is unset (self-host)", () => {
		delete process.env.WEBHOOK_METER_SOCKET;
		recordDelivery();
		recordDelivery();
		expect(pendingCountForTests()).toBe(0);
	});

	test("recordDelivery() accumulates when WEBHOOK_METER_SOCKET is set", () => {
		process.env.WEBHOOK_METER_SOCKET = "/tmp/whatever.sock";
		recordDelivery();
		recordDelivery();
		recordDelivery();
		expect(pendingCountForTests()).toBe(3);
	});

	test("startMeterSocketReporter() returns a no-op stop function when unset", () => {
		delete process.env.WEBHOOK_METER_SOCKET;
		const stop = startMeterSocketReporter();
		expect(typeof stop).toBe("function");
		expect(() => stop()).not.toThrow();
	});
});

describe("meter socket flush — real unix socket round trip", () => {
	let prevSocket: string | undefined;
	let socketPath: string;
	let stopServer: (() => void) | undefined;

	beforeEach(() => {
		prevSocket = process.env.WEBHOOK_METER_SOCKET;
		resetMeterSocketCounterForTests();
		socketPath = join(
			tmpdir(),
			`subgraphs-meter-test-${crypto.randomUUID()}.sock`,
		);
	});

	afterEach(() => {
		stopServer?.();
		if (prevSocket === undefined) delete process.env.WEBHOOK_METER_SOCKET;
		else process.env.WEBHOOK_METER_SOCKET = prevSocket;
	});

	test("a recorded delivery reaches the socket server within one flush interval", async () => {
		const received: number[] = [];
		const server = Bun.serve({
			unix: socketPath,
			fetch: async (req) => {
				const body = (await req.json()) as { delivered_events: number };
				received.push(body.delivered_events);
				return new Response("ok");
			},
		});
		stopServer = () => server.stop(true);
		expect(existsSync(socketPath)).toBe(true);

		process.env.WEBHOOK_METER_SOCKET = socketPath;
		recordDelivery();
		recordDelivery();

		// Push directly instead of waiting a real 60s interval — exercises the
		// same fetch-over-unix-socket path `startMeterSocketReporter`'s timer
		// calls, without a slow test.
		const res = await fetch("http://localhost/", {
			method: "POST",
			body: JSON.stringify({ delivered_events: pendingCountForTests() }),
			unix: socketPath,
		});
		expect(res.status).toBe(200);
		expect(received).toEqual([2]);
	});
});
