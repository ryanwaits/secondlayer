import { describe, expect, mock, test } from "bun:test";

// Reproduces the prod 500 on GET /v1/contracts: the `contracts` table is a
// SOURCE-plane table (TABLE_TO_DB.contracts === "source"), but the route read
// from getDb() (= target/control plane). With the split live, the target DB has
// no `contracts` table → "relation does not exist" → 500. The route must read
// from the source plane. We mark each plane's db and make the query throw on the
// target plane (mirroring the missing table), then assert the route 200s.
const SOURCE_DB = { plane: "source" } as const;
const TARGET_DB = { plane: "target" } as const;

mock.module("@secondlayer/shared/db", () => ({
	getSourceDb: () => SOURCE_DB,
	getTargetDb: () => TARGET_DB,
	getDb: () => TARGET_DB,
}));

mock.module("@secondlayer/shared/db/queries/contracts", () => ({
	listContractsByTrait: async (db: { plane: string }) => {
		if (db.plane !== "source") {
			throw new Error('relation "contracts" does not exist');
		}
		return [];
	},
	getContract: async (db: { plane: string }, contractId: string) => {
		if (db.plane !== "source") {
			throw new Error('relation "contracts" does not exist');
		}
		if (contractId === "SP1.known") {
			return {
				contract_id: "SP1.known",
				deployer: "SP1",
				block_height: 100,
				declared_traits: ["sip-010"],
				inferred_standards: ["sip-010"],
				abi_status: "ok",
				abi: { functions: [{ name: "transfer" }] },
			};
		}
		return null;
	},
}));

const { Hono } = await import("hono");
const { errorHandler } = await import("../middleware/error.ts");
const contractsRouter = (await import("./contracts.ts")).default;

function app() {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/v1/contracts", contractsRouter);
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
