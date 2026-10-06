import { afterAll, describe, expect, test } from "bun:test";
import { getDb, sql } from "../index.ts";
import {
	cancelOrphanedSubgraphOperations,
	createSubgraphOperation,
	requestSubgraphOperationsCancelForDelete,
} from "./subgraph-operations.ts";
import { registerSubgraph } from "./subgraphs.ts";

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("cancelOrphanedSubgraphOperations", () => {
	const names: string[] = [];

	/** One reindex op, cancel already requested, lock `lockSeconds` from now. */
	async function seed(opts: {
		status: "queued" | "running";
		lockSeconds?: number;
		cancelRequested?: boolean;
	}) {
		const db = getDb();
		const name = `orphan-test-${crypto.randomUUID().slice(0, 8)}`;
		names.push(name);
		const subgraph = await registerSubgraph(db, {
			name,
			version: "1",
			definition: { name, sources: {}, schema: {}, handlers: {} },
			schemaHash: `${name}-hash`,
			handlerPath: `/tmp/${name}.ts`,
		});
		const op = await createSubgraphOperation(db, {
			subgraphId: subgraph.id,
			subgraphName: name,
			kind: "reindex",
		});
		if (opts.status === "running") {
			await db
				.updateTable("subgraph_operations")
				.set({
					status: "running",
					locked_by: "runner",
					locked_until: sql<Date>`now() + ${`${opts.lockSeconds ?? 60} seconds`}::interval`,
				})
				.where("id", "=", op.id)
				.execute();
		}
		if (opts.cancelRequested !== false) {
			await requestSubgraphOperationsCancelForDelete(db, subgraph.id);
		}
		return { subgraphId: subgraph.id, opId: op.id };
	}

	async function statusOf(opId: string) {
		return (
			await getDb()
				.selectFrom("subgraph_operations")
				.select(["status", "locked_by"])
				.where("id", "=", opId)
				.executeTakeFirstOrThrow()
		).status;
	}

	afterAll(async () => {
		if (SKIP) return;
		const db = getDb();
		await db
			.deleteFrom("subgraph_operations")
			.where("subgraph_name", "in", names)
			.execute();
		await db.deleteFrom("subgraphs").where("name", "in", names).execute();
	});

	test("a running operation whose lock lapsed is cancelled", async () => {
		const { subgraphId, opId } = await seed({
			status: "running",
			lockSeconds: -30,
		});
		expect(await cancelOrphanedSubgraphOperations(getDb(), subgraphId)).toBe(1);
		expect(await statusOf(opId)).toBe("cancelled");
	});

	test("a running operation with a live lock is never touched", async () => {
		const { subgraphId, opId } = await seed({
			status: "running",
			lockSeconds: 60,
		});
		expect(await cancelOrphanedSubgraphOperations(getDb(), subgraphId)).toBe(0);
		expect(await statusOf(opId)).toBe("running");
	});

	test("a queued operation no runner claimed is cancelled", async () => {
		const { subgraphId, opId } = await seed({ status: "queued" });
		expect(await cancelOrphanedSubgraphOperations(getDb(), subgraphId)).toBe(1);
		expect(await statusOf(opId)).toBe("cancelled");
	});

	test("an operation nobody asked to cancel is left alone even with a lapsed lock", async () => {
		const { subgraphId, opId } = await seed({
			status: "running",
			lockSeconds: -30,
			cancelRequested: false,
		});
		expect(await cancelOrphanedSubgraphOperations(getDb(), subgraphId)).toBe(0);
		expect(await statusOf(opId)).toBe("running");
	});
});
