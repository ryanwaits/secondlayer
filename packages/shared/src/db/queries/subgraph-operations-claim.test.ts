import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "../index.ts";
import {
	claimSubgraphOperation,
	createSubgraphOperation,
} from "./subgraph-operations.ts";
import { registerSubgraph } from "./subgraphs.ts";

const SKIP = !process.env.DATABASE_URL;
const RUNNER = "claim-test-runner";

describe.skipIf(SKIP)("claimSubgraphOperation budget + ordering", () => {
	const accFree = crypto.randomUUID();
	const accEnterprise = crypto.randomUUID();
	const names: string[] = [];

	async function subgraphFor(account: string): Promise<string> {
		const db = getDb();
		const name = `claim-test-${names.length}-${account.slice(0, 6)}`;
		names.push(name);
		await registerSubgraph(db, {
			name,
			version: "1",
			accountId: account,
			schemaName: `sg_claim_${names.length}_${account.slice(0, 6)}`,
			definition: { name, sources: {}, schema: {}, handlers: {} },
			schemaHash: `${name}-hash`,
			handlerPath: `/tmp/${name}.ts`,
			startBlock: 1,
		});
		const row = await db
			.selectFrom("subgraphs")
			.select("id")
			.where("name", "=", name)
			.executeTakeFirstOrThrow();
		return row.id;
	}

	beforeAll(async () => {
		const db = getDb();
		await db
			.insertInto("accounts")
			.values([
				{ id: accFree, email: `${accFree}@t.local`, plan: "none" },
				{
					id: accEnterprise,
					email: `${accEnterprise}@t.local`,
					plan: "enterprise",
				},
			])
			.execute();
	});

	afterAll(async () => {
		const db = getDb();
		await db
			.deleteFrom("subgraph_operations")
			.where("subgraph_name", "like", "claim-test-%")
			.execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "like", "claim-test-%")
			.execute();
		await db
			.deleteFrom("accounts")
			.where("id", "in", [accFree, accEnterprise])
			.execute();
	});

	test("heavy ops stop claiming at the budget; light flow past queued heavy", async () => {
		const db = getDb();
		// budget=2: two heavy claims succeed, third heavy blocked, light passes.
		const ids = await Promise.all([
			subgraphFor(accFree),
			subgraphFor(accFree),
			subgraphFor(accFree),
			subgraphFor(accFree),
		]);
		await createSubgraphOperation(db, {
			subgraphId: ids[0] as string,
			subgraphName: names[0] as string,
			accountId: accFree,
			kind: "reindex",
			weight: "heavy",
		});
		await createSubgraphOperation(db, {
			subgraphId: ids[1] as string,
			subgraphName: names[1] as string,
			accountId: accFree,
			kind: "reindex",
			weight: "heavy",
		});
		await createSubgraphOperation(db, {
			subgraphId: ids[2] as string,
			subgraphName: names[2] as string,
			accountId: accFree,
			kind: "reindex",
			weight: "heavy",
		});
		await createSubgraphOperation(db, {
			subgraphId: ids[3] as string,
			subgraphName: names[3] as string,
			accountId: accFree,
			kind: "reindex",
			weight: "light",
		});

		const first = await claimSubgraphOperation(db, RUNNER);
		const second = await claimSubgraphOperation(db, RUNNER);
		expect(first?.weight).toBe("heavy");
		expect(second?.weight).toBe("heavy");
		// budget (2) reached → the queued heavy is ineligible, light claims instead
		const third = await claimSubgraphOperation(db, RUNNER);
		expect(third?.weight).toBe("light");
		// nothing else eligible: remaining heavy stays blocked
		const fourth = await claimSubgraphOperation(db, RUNNER);
		expect(fourth).toBeNull();
	});

	test("plan rank breaks ties: enterprise claims before free at equal fairness", async () => {
		const db = getDb();
		// Equalize fairness: clear test 1's running ops so both accounts are at 0.
		await db
			.updateTable("subgraph_operations")
			.set({ status: "completed", finished_at: new Date() })
			.where("subgraph_name", "like", "claim-test-%")
			.execute();
		const freeId = await subgraphFor(accFree);
		const entId = await subgraphFor(accEnterprise);
		// free op created FIRST — plan rank must still win at equal running-count
		await createSubgraphOperation(db, {
			subgraphId: freeId,
			subgraphName: names[names.length - 2] as string,
			accountId: accFree,
			kind: "reindex",
			weight: "light",
		});
		await createSubgraphOperation(db, {
			subgraphId: entId,
			subgraphName: names[names.length - 1] as string,
			accountId: accEnterprise,
			kind: "reindex",
			weight: "light",
		});
		const claimed = await claimSubgraphOperation(db, RUNNER);
		expect(claimed?.account_id).toBe(accEnterprise);
	});
});
