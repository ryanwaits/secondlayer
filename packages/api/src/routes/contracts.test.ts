import { describe, expect, test } from "bun:test";
import type { Database } from "@secondlayer/shared/db";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { errorHandler } from "../middleware/error.ts";
import { createContractsRouter } from "./contracts.ts";

// Reproduces the prod 500 on GET /v1/contracts: the `contracts` table is a
// SOURCE-plane table (TABLE_TO_DB.contracts === "source"), but the route read
// from getDb() (= target/control plane). With the split live, the target DB has
// no `contracts` table → "relation does not exist" → 500. The route must read
// from the source plane.
//
// We inject the route's db + query seams (no mock.module on @secondlayer/shared/db —
// Bun leaks module mocks across files, which corrupts getDb()/sql for any suite
// that runs after this one). A sentinel SOURCE_DB proves the source plane is used:
// the fake queries assert they were handed exactly that handle.
const SOURCE_DB = { plane: "source" } as unknown as Kysely<Database>;

function app() {
	const router = createContractsRouter({
		getSourceDb: () => SOURCE_DB,
		listContractsByTrait: async (db) => {
			expect(db).toBe(SOURCE_DB);
			return [];
		},
		getContract: async (db, contractId) => {
			expect(db).toBe(SOURCE_DB);
			if (contractId === "SP1.known") {
				return {
					contract_id: "SP1.known",
					deployer: "SP1",
					block_height: 100,
					declared_traits: ["sip-010"],
					inferred_standards: ["sip-010"],
					abi_status: "ok",
					abi: { functions: [{ name: "transfer" }] },
					// biome-ignore lint/suspicious/noExplicitAny: test fixture row
				} as any;
			}
			return null;
		},
	});
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/v1/contracts", router);
	return a;
}

describe("GET /v1/contracts plane", () => {
	test("reads the source plane (where the contracts table lives), not target", async () => {
		const res = await app().request("/v1/contracts?trait=sip-010&limit=1");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { contracts: unknown[] };
		expect(Array.isArray(body.contracts)).toBe(true);
	});
});

describe("GET /v1/contracts/:contractId", () => {
	test("returns the contract with its ABI when include=abi", async () => {
		const res = await app().request("/v1/contracts/SP1.known?include=abi");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { contract: { abi?: unknown } };
		expect(body.contract.abi).toEqual({ functions: [{ name: "transfer" }] });
	});

	test("omits the ABI by default", async () => {
		const res = await app().request("/v1/contracts/SP1.known");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { contract: { abi?: unknown } };
		expect(body.contract.abi).toBeUndefined();
	});

	test("404 when the contract is not in the registry", async () => {
		const res = await app().request("/v1/contracts/SP1.missing");
		expect(res.status).toBe(404);
	});
});

describe("GET /v1/contracts classified_after", () => {
	function appCapturing(
		onList: (opts: { classifiedAfter?: Date }) => void,
		rows: unknown[] = [],
	) {
		const router = createContractsRouter({
			getSourceDb: () => SOURCE_DB,
			listContractsByTrait: async (_db, _trait, opts) => {
				onList(opts ?? {});
				// biome-ignore lint/suspicious/noExplicitAny: test fixture rows
				return rows as any;
			},
		});
		const a = new Hono();
		a.onError(errorHandler);
		a.route("/v1/contracts", router);
		return a;
	}

	test("forwards classified_after to the registry query", async () => {
		let seen: Date | undefined;
		const res = await appCapturing((o) => {
			seen = o.classifiedAfter;
		}).request(
			"/v1/contracts?trait=sip-010&classified_after=2026-10-15T17:00:00.000Z",
		);
		expect(res.status).toBe(200);
		expect(seen?.toISOString()).toBe("2026-10-15T17:00:00.000Z");
	});

	test("rejects a classified_after that is not a timestamp", async () => {
		const res = await appCapturing(() => {}).request(
			"/v1/contracts?trait=sip-010&classified_after=yesterday",
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("INVALID_CLASSIFIED_AFTER");
	});

	test("summaries carry classified_at", async () => {
		const row = {
			contract_id: "SP1.known",
			deployer: "SP1",
			block_height: 100,
			declared_traits: ["sip-010"],
			inferred_standards: [],
			abi_status: "fetched",
			abi_fetched_at: new Date("2026-10-15T17:15:45.764Z"),
		};
		const res = await appCapturing(() => {}, [
			row,
			{ ...row, contract_id: "SP1.pending", abi_fetched_at: null },
		]).request("/v1/contracts?trait=sip-010");
		const body = (await res.json()) as {
			contracts: { classified_at: string | null }[];
		};
		expect(body.contracts.map((c) => c.classified_at)).toEqual([
			"2026-10-15T17:15:45.764Z",
			null,
		]);
	});
});
