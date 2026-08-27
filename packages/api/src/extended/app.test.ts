import { describe, expect, test } from "bun:test";
import { createApiApp } from "../create-app.ts";
import type { IndexTip } from "../index/tip.ts";
import { createExtendedApp } from "./app.ts";
import { EXTENDED_API_VERSION, type ExtendedCanonicalBlock } from "./status.ts";

const TIP: IndexTip = {
	block_height: 12_345,
	finalized_height: 12_340,
	lag_seconds: 2,
};

const BLOCK: ExtendedCanonicalBlock = {
	block_height: 12_345,
	block_hash: "0xabc",
	index_block_hash: "0xdef",
	burn_block_height: 850_000,
};

const EMPTY_TIP: IndexTip = {
	block_height: 0,
	finalized_height: 0,
	lag_seconds: 0,
};

describe("createExtendedApp", () => {
	test("GET /extended/v1/status returns 200 with chain_tip", async () => {
		const app = createExtendedApp({
			getTip: async () => TIP,
			readCanonicalBlock: async () => BLOCK,
		});
		const res = await app.request("/extended/v1/status");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			server_version: string;
			status: string;
			chain_tip: typeof BLOCK;
		};
		expect(body.server_version).toBe(
			`secondlayer-extended/${EXTENDED_API_VERSION}`,
		);
		expect(body.status).toBe("ready");
		expect(body.chain_tip).toEqual(BLOCK);
	});

	test("empty tip omits chain_tip and stays ready", async () => {
		const app = createExtendedApp({
			getTip: async () => EMPTY_TIP,
			readCanonicalBlock: async () => {
				throw new Error("readCanonicalBlock must not be called for empty tip");
			},
		});
		const res = await app.request("/extended/v1/status");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			status: string;
			chain_tip?: unknown;
		};
		expect(body.status).toBe("ready");
		expect(body.chain_tip).toBeUndefined();
	});

	test("tip height with missing block omits chain_tip", async () => {
		const app = createExtendedApp({
			getTip: async () => TIP,
			readCanonicalBlock: async () => null,
		});
		const res = await app.request("/extended/v1/status");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { chain_tip?: unknown };
		expect(body.chain_tip).toBeUndefined();
	});

	test("unknown path 404 is Hiro-shaped (no code/path)", async () => {
		const app = createExtendedApp({
			getTip: async () => EMPTY_TIP,
			readCanonicalBlock: async () => null,
		});
		const res = await app.request("/extended/v1/nope");
		expect(res.status).toBe(404);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ error: "Not found" });
		expect("code" in body).toBe(false);
		expect("path" in body).toBe(false);
		expect("next_cursor" in body).toBe(false);
	});

	test("GET /extended points at status", async () => {
		const app = createExtendedApp({
			getTip: async () => EMPTY_TIP,
			readCanonicalBlock: async () => null,
		});
		const res = await app.request("/extended");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "/extended/v1/status" });
	});

	test("createApiApp still 404s /extended with v1 envelope", async () => {
		const app = createApiApp("oss");
		const res = await app.request("/extended/v1/status");
		expect(res.status).toBe(404);
		const body = (await res.json()) as {
			error: string;
			code: string;
			path: string;
		};
		expect(body.code).toBe("NOT_FOUND");
		expect(body.path).toBe("/extended/v1/status");
	});

	test("status handler does not import a node client", async () => {
		// Contract: deps are injectable; default path uses Index tip + blocks table.
		// Guard against accidental STACKS_NODE / StacksNodeClient coupling in this dir.
		const { readdirSync, readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const dir = join(import.meta.dir);
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
			const src = readFileSync(join(dir, name), "utf8");
			expect(src).not.toMatch(
				/StacksNodeClient|STACKS_NODE_RPC_URL|STACKS_CORE_RPC/,
			);
			expect(src).not.toMatch(/["']\/v2/);
		}
	});
});
