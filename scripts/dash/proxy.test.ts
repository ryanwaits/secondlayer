import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { GET } from "../../skills/secondlayer/dash/template/api/sl/[...path].ts";
import { type Stub, startUpstream } from "./upstream.ts";

const KEY = "sk-sl_test_key";
const ENV = [
	"SL_DASH_BASE_MAINNET",
	"SECONDLAYER_DEVNET_URL",
	"SECONDLAYER_API_KEY",
	"INSTANCE_TOKEN",
] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

let up: Stub;

beforeAll(() => {
	up = startUpstream();
	process.env.SL_DASH_BASE_MAINNET = up.url;
	process.env.SECONDLAYER_DEVNET_URL = `${up.url}/devnet`;
	process.env.SECONDLAYER_API_KEY = KEY;
	delete process.env.INSTANCE_TOKEN;
});

afterAll(() => {
	up.stop();
	for (const k of ENV) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

beforeEach(() => {
	up.seen.length = 0;
});

const get = (path: string, init?: RequestInit) =>
	GET(new Request(`http://localhost:4400/api/sl${path}`, init));

describe("dash proxy", () => {
	test("anything but GET is a 405", async () => {
		const res = await get("/mainnet/api/webhooks", { method: "POST" });
		expect(res.status).toBe(405);
		expect(up.seen).toHaveLength(0);
	});

	test("a path off the allowlist is a 404 that never reaches the upstream", async () => {
		for (const path of [
			"/mainnet/api/keys",
			"/mainnet/api/accounts/me",
			"/mainnet/api/webhooks/wh_1/replay",
			"/mainnet/api/webhooks/..%2F..%2Fkeys",
			"/testnet/api/subgraphs",
			"/testnet/api/billing/usage",
			"/moonnet/api/webhooks",
		]) {
			expect((await get(path)).status).toBe(404);
		}
		expect(up.seen).toHaveLength(0);
	});

	test("an allowed read carries the account key, never the browser's credentials", async () => {
		const res = await get("/mainnet/api/webhooks", {
			headers: {
				authorization: "Bearer from-the-browser",
				cookie: "sid=browser",
			},
		});
		expect(res.status).toBe(200);
		expect(up.seen).toEqual([
			{ path: "/api/webhooks", authorization: `Bearer ${KEY}`, cookie: null },
		]);
	});

	test("one delivery's payload is an allowed read", async () => {
		await get("/mainnet/api/webhooks/wh_1/deliveries/del_9");
		expect(up.seen.map((s) => s.path)).toEqual([
			"/api/webhooks/wh_1/deliveries/del_9",
		]);
	});

	test("set-cookie from the upstream is stripped", async () => {
		const res = await get("/mainnet/api/webhooks");
		expect(res.headers.get("set-cookie")).toBeNull();
		expect(await res.json()).toMatchObject({ data: [{ id: "wh_1" }] });
	});

	test("reads are cacheable for 5s at the edge, usage for 5 minutes", async () => {
		const read = await get("/mainnet/api/webhooks");
		expect(read.headers.get("cache-control")).toBe(
			"public, s-maxage=5, stale-while-revalidate=25",
		);
		const usage = await get("/mainnet/api/billing/usage?month=2026-11");
		expect(usage.headers.get("cache-control")).toBe("public, s-maxage=300");
		expect(up.seen.at(-1)?.path).toBe("/api/billing/usage?month=2026-11");
	});

	test("upstream errors pass through uncached", async () => {
		const res = await get("/mainnet/api/webhooks/missing");
		expect(res.status).toBe(404);
		expect(res.headers.get("cache-control")).toBe("no-store");
	});

	test("testnet reads go to /testnet on the hosted API with the same key", async () => {
		await get("/testnet/api/webhooks");
		expect(up.seen).toEqual([
			{
				path: "/testnet/api/webhooks",
				authorization: `Bearer ${KEY}`,
				cookie: null,
			},
		]);
	});

	test("devnet sends INSTANCE_TOKEN only when it is set", async () => {
		await get("/devnet/api/webhooks");
		expect(up.seen[0]).toMatchObject({
			path: "/devnet/api/webhooks",
			authorization: null,
		});
		process.env.INSTANCE_TOKEN = "abc123";
		try {
			await get("/devnet/api/webhooks");
			expect(up.seen[1]).toMatchObject({ authorization: "Bearer abc123" });
		} finally {
			delete process.env.INSTANCE_TOKEN;
		}
	});

	test("/health reports each network's reachability and is cached", async () => {
		const first = await get("/health");
		expect(first.headers.get("cache-control")).toBe("public, s-maxage=60");
		expect(await first.json()).toEqual({
			mainnet: { ok: true, base: up.url },
			testnet: { ok: true, base: `${up.url}/testnet` },
			devnet: { ok: true, base: `${up.url}/devnet` },
		});
		await get("/health");
		expect(up.seen.map((s) => s.path).sort()).toEqual([
			"/devnet/health",
			"/health",
			"/testnet/health",
		]);
	});
});
