import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "../index.ts";
import {
	claimSubgraphOperation,
	createSubgraphOperation,
	getOperationQueuePosition,
} from "./subgraph-operations.ts";
import { registerSubgraph } from "./subgraphs.ts";

const SKIP = !process.env.DATABASE_URL;
const RUNNER = "claim-test-runner";

describe.skipIf(SKIP)("claimSubgraphOperation budget + ordering", () => {
	const accA = crypto.randomUUID();
	const accB = crypto.randomUUID();
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
				{ id: accA, email: `${accA}@t.local` },
				{ id: accB, email: `${accB}@t.local` },
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
		await db.deleteFrom("accounts").where("id", "in", [accA, accB]).execute();
	});

	test("heavy ops stop claiming at the budget; light flow past queued heavy", async () => {
		const db = getDb();
		// budget=2: two heavy claims succeed, third heavy blocked, light passes.
		const ids = await Promise.all([
			subgraphFor(accA),
			subgraphFor(accA),
			subgraphFor(accA),
			subgraphFor(accA),
		]);
		await createSubgraphOperation(db, {
			subgraphId: ids[0] as string,
			subgraphName: names[0] as string,
			accountId: accA,
			kind: "reindex",
			weight: "heavy",
		});
		await createSubgraphOperation(db, {
			subgraphId: ids[1] as string,
			subgraphName: names[1] as string,
			accountId: accA,
			kind: "reindex",
			weight: "heavy",
		});
		await createSubgraphOperation(db, {
			subgraphId: ids[2] as string,
			subgraphName: names[2] as string,
			accountId: accA,
			kind: "reindex",
			weight: "heavy",
		});
		await createSubgraphOperation(db, {
			subgraphId: ids[3] as string,
			subgraphName: names[3] as string,
			accountId: accA,
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

	test("queue positions mirror claim order across accounts (FIFO, no plan rank)", async () => {
		const db = getDb();
		await db
			.updateTable("subgraph_operations")
			.set({ status: "completed", finished_at: new Date() })
			.where("subgraph_name", "like", "claim-test-%")
			.execute();
		const a = await subgraphFor(accA);
		const b = await subgraphFor(accB);
		const c2 = await subgraphFor(accA);
		const opA = await createSubgraphOperation(db, {
			subgraphId: a,
			subgraphName: names[names.length - 3] as string,
			accountId: accA,
			kind: "reindex",
			weight: "light",
		});
		const opB = await createSubgraphOperation(db, {
			subgraphId: b,
			subgraphName: names[names.length - 2] as string,
			accountId: accB,
			kind: "reindex",
			weight: "light",
		});
		const opC = await createSubgraphOperation(db, {
			subgraphId: c2,
			subgraphName: names[names.length - 1] as string,
			accountId: accA,
			kind: "reindex",
			weight: "light",
		});
		// No plan rank exists: at equal fairness the queue is pure FIFO.
		expect(await getOperationQueuePosition(db, opA.id)).toBe(1);
		expect(await getOperationQueuePosition(db, opB.id)).toBe(2);
		expect(await getOperationQueuePosition(db, opC.id)).toBe(3);
		// claim order matches the advertised positions
		const first = await claimSubgraphOperation(db, RUNNER);
		expect(first?.id).toBe(opA.id);
		// running op no longer has a position
		expect(await getOperationQueuePosition(db, opA.id)).toBeNull();
	});
});
