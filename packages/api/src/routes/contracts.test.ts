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
