import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import {
	claimSubgraphOperation,
	createSubgraphOperation,
	heartbeatSubgraphOperation,
} from "@secondlayer/shared/db/queries/subgraph-operations";
import { LOST_LEASE, renewOperationLease } from "./processor.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const db = getDb();
const names: string[] = [];

afterEach(async () => {
	for (const name of names.splice(0)) {
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
});

async function claimedOperation(runner: string) {
	const name = `fence-${randomUUID().slice(0, 8)}`;
	names.push(name);
	const sg = await db
		.insertInto("subgraphs")
		.values({
			name,
			status: "reindexing",
			definition: { name, sources: {}, schema: {} },
			schema_hash: "test",
			handler_path: "test",
			schema_name: `sg_${name.replace(/-/g, "_")}`,
			account_id: randomUUID(),
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	await createSubgraphOperation(db, {
		subgraphId: sg.id,
		subgraphName: name,
		kind: "reindex",
	});
	const op = await claimSubgraphOperation(db, runner);
	if (!op) throw new Error("operation not claimed");
	return op;
}

describe("an operation runner that lost its lease stops writing", () => {
	it("keeps walking while the heartbeat still renews the lease", async () => {
		const op = await claimedOperation("runner-a");
		const controller = new AbortController();

		await renewOperationLease(db, op.id, "runner-a", controller);

		expect(controller.signal.aborted).toBe(false);
	});

	it("aborts the walk when another runner holds the operation", async () => {
		const op = await claimedOperation("runner-a");
		await db
			.updateTable("subgraph_operations")
			.set({ locked_by: "runner-b" })
			.where("id", "=", op.id)
			.execute();
		const controller = new AbortController();

		await renewOperationLease(db, op.id, "runner-a", controller);

		expect(controller.signal.aborted).toBe(true);
		expect(controller.signal.reason).toBe(LOST_LEASE);
	});

	it("reports how many rows the heartbeat renewed", async () => {
		const op = await claimedOperation("runner-a");

		expect(await heartbeatSubgraphOperation(db, op.id, "runner-a")).toBe(1);
		expect(await heartbeatSubgraphOperation(db, op.id, "someone-else")).toBe(0);
	});
});
