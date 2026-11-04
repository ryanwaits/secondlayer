import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { register } from "./instrumentation";

const realFetch = globalThis.fetch;
const realEnv = {
	runtime: process.env.NEXT_RUNTIME,
	phase: process.env.NEXT_PHASE,
};

let urls: string[] = [];

beforeEach(() => {
	urls = [];
	globalThis.fetch = (async (url: string) => {
		urls.push(String(url));
		throw new Error("network down");
	}) as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	for (const [key, value] of [
		["NEXT_RUNTIME", realEnv.runtime],
		["NEXT_PHASE", realEnv.phase],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("register", () => {
	test("returns at once and warms the API connection, even when that fetch fails", async () => {
		process.env.NEXT_RUNTIME = "nodejs";
		delete process.env.NEXT_PHASE;
		const result = register();
		expect(result).toBeUndefined();
		await settle();
		expect(urls).toHaveLength(1);
		expect(urls[0]).toEndWith("/health");
	});

	test("does nothing outside the node runtime", async () => {
		process.env.NEXT_RUNTIME = "edge";
		register();
		await settle();
		expect(urls).toEqual([]);
	});

	test("does nothing during the production build", async () => {
		process.env.NEXT_RUNTIME = "nodejs";
		process.env.NEXT_PHASE = "phase-production-build";
		register();
		await settle();
		expect(urls).toEqual([]);
	});
});
