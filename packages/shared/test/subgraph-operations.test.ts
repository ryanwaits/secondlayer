import { afterEach, describe, expect, test } from "bun:test";
import { getDb } from "../src/db/index.ts";
import {
	claimSubgraphOperation,
	createSubgraphOperation,
	findActiveSubgraphOperation,
	isActiveSubgraphOperationConflict,
	requestSubgraphOperationCancel,
} from "../src/db/queries/subgraph-operations.ts";
import { registerSubgraph } from "../src/db/queries/subgraphs.ts";

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("Subgraph Operations Queries", () => {
	const testDef = {
		name: "test-operation-subgraph",
		version: "1.0.0",
		definition: {
			name: "test-operation-subgraph",
			sources: [{ contract: "SP::c" }],
			schema: {},
		},
		schemaHash: "operation-hash",
		handlerPath: "/tmp/test-operation-subgraph.ts",
	};

	afterEach(async () => {
		const db = getDb();
		await db.deleteFrom("subgraphs").execute();
	});

	test("creates and finds an active operation", async () => {
		const db = getDb();
		const subgraph = await registerSubgraph(db, testDef);
		const operation = await createSubgraphOperation(db, {
			subgraphId: subgraph.id,
			subgraphName: subgraph.name,
			accountId: subgraph.account_id,
			kind: "reindex",
			fromBlock: 10,
			toBlock: 20,
		});

		const active = await findActiveSubgraphOperation(db, subgraph.id);
		expect(active?.id).toBe(operation.id);
		expect(active?.status).toBe("queued");
		expect(Number(active?.from_block)).toBe(10);
	});

	test("rejects duplicate queued or running operations per subgraph", async () => {
		const db = getDb();
		const subgraph = await registerSubgraph(db, testDef);
		await createSubgraphOperation(db, {
			subgraphId: subgraph.id,
			subgraphName: subgraph.name,
			kind: "reindex",
		});

		let err: unknown;
		try {
			await createSubgraphOperation(db, {
				subgraphId: subgraph.id,
				subgraphName: subgraph.name,
				kind: "backfill",
				fromBlock: 1,
				toBlock: 2,
			});
		} catch (caught) {
			err = caught;
		}

		expect(isActiveSubgraphOperationConflict(err)).toBe(true);
	});

	test("claims queued operations and records cancel requests", async () => {
		const db = getDb();
		const subgraph = await registerSubgraph(db, testDef);
		await createSubgraphOperation(db, {
			subgraphId: subgraph.id,
			subgraphName: subgraph.name,
			kind: "reindex",
		});

		const claimed = await claimSubgraphOperation(db, "test-runner");
		expect(claimed?.status).toBe("running");
		expect(claimed?.locked_by).toBe("test-runner");

		const cancelled = await requestSubgraphOperationCancel(db, subgraph.id);
		expect(cancelled?.id).toBe(claimed?.id);
		expect(cancelled?.cancel_requested).toBe(true);
	});
});
