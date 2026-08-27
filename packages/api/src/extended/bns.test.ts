import { describe, expect, test } from "bun:test";
import { createExtendedApp } from "./app.ts";
import { type ExtendedBnsName, projectBnsName } from "./bns.ts";

const NAME: ExtendedBnsName = {
	name: "alice",
	namespace: "btc",
	fqn: "alice.btc",
	owner: "SP1OWNER",
	bns_id: "u1",
	topic: "new-name",
	tx_id: "0xabc",
	block_height: 100,
	registered_at: 1_700_000_000,
	renewal_height: 200,
};

describe("projectBnsName", () => {
	test("maps real columns only", () => {
		expect(
			projectBnsName({
				name: "alice",
				namespace: "btc",
				fqn: "alice.btc",
				owner: "SP1OWNER",
				bns_id: "u1",
				topic: "new-name",
				tx_id: "0xabc",
				block_height: "100",
				registered_at: "1700000000",
				renewal_height: "200",
			}),
		).toEqual(NAME);
	});
});

describe("extended BNS routes", () => {
	test("decoder-off → empty list", async () => {
		const app = createExtendedApp({
			bnsEnabled: false,
			listBnsNames: async () => {
				throw new Error("listBnsNames must not run when decoder off");
			},
		});
		const res = await app.request(
			"/extended/v1/names?address=SP1OWNER&limit=10&offset=0",
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			limit: 10,
			offset: 0,
			total: 0,
			results: [],
		});
	});

	test("decoder-off → {} for single name (not 404)", async () => {
		const app = createExtendedApp({
			bnsEnabled: false,
			getBnsName: async () => {
				throw new Error("getBnsName must not run when decoder off");
			},
		});
		const res = await app.request("/extended/v1/names/alice.btc");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({});
	});

	test("decoder-on + injected row → 200 with mapped columns", async () => {
		const app = createExtendedApp({
			bnsEnabled: true,
			getBnsName: async (fqn) => {
				expect(fqn).toBe("alice.btc");
				return NAME;
			},
		});
		const res = await app.request("/extended/v1/names/alice.btc");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(NAME);
	});

	test("decoder-on missing name → 404 Hiro-shaped", async () => {
		const app = createExtendedApp({
			bnsEnabled: true,
			getBnsName: async () => null,
		});
		const res = await app.request("/extended/v1/names/missing.btc");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Not found" });
	});

	test("decoder-on list by address", async () => {
		let seen: string | undefined;
		const app = createExtendedApp({
			bnsEnabled: true,
			listBnsNames: async (q) => {
				seen = q.address;
				return { results: [NAME], total: 1 };
			},
		});
		const res = await app.request("/extended/v1/names?address=SP1OWNER");
		expect(res.status).toBe(200);
		expect(seen).toBe("SP1OWNER");
		const body = (await res.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual([
			"limit",
			"offset",
			"results",
			"total",
		]);
		expect(body.results).toEqual([NAME]);
	});

	test("decoder-on list without address → 400", async () => {
		const app = createExtendedApp({
			bnsEnabled: true,
			listBnsNames: async () => ({ results: [], total: 0 }),
		});
		const res = await app.request("/extended/v1/names");
		expect(res.status).toBe(400);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.error).toBeTruthy();
		expect("code" in body).toBe(false);
	});
});
