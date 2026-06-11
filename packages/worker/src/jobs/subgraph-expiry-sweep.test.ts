import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { registerSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import { sweepExpiredSubgraphs } from "./subgraph-expiry-sweep.ts";

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("subgraph expiry sweep", () => {
	const ACCOUNT = crypto.randomUUID();
	const EXPIRED = "expiry-sweep-expired-sg";
	const FRESH = "expiry-sweep-fresh-sg";
	const ETERNAL = "expiry-sweep-eternal-sg";

	async function fixture(name: string, expiresAt: Date | null) {
		const db = getDb();
		await registerSubgraph(db, {
			name,
			version: "1",
			accountId: ACCOUNT,
			schemaName: `sg_sweep_${name.replace(/-/g, "_")}`,
			definition: { name, sources: {}, schema: {}, handlers: {} },
			schemaHash: `${name}-hash`,
			handlerPath: `/tmp/${name}.ts`,
			startBlock: 1,
		});
		await db
			.updateTable("subgraphs")
			.set({ expires_at: expiresAt })
			.where("name", "=", name)
			.execute();
	}

	beforeAll(async () => {
		const db = getDb();
		await db
			.insertInto("accounts")
			.values({ id: ACCOUNT, email: `${ACCOUNT}@test.local`, plan: "none" })
			.onConflict((oc) => oc.column("id").doNothing())
			.execute();
		await fixture(EXPIRED, new Date(Date.now() - 60_000));
		await fixture(FRESH, new Date(Date.now() + 86_400_000));
		await fixture(ETERNAL, null);
	});

	afterAll(async () => {
		const db = getDb();
		await db
			.deleteFrom("subgraphs")
			.where("name", "in", [EXPIRED, FRESH, ETERNAL])
			.execute();
		await db.deleteFrom("accounts").where("id", "=", ACCOUNT).execute();
	});

	test("deletes only past-expiry subgraphs", async () => {
		const db = getDb();
		const deleted = await sweepExpiredSubgraphs(db);
		expect(deleted).toContain(EXPIRED);
		expect(deleted).not.toContain(FRESH);
		expect(deleted).not.toContain(ETERNAL);

		const remaining = await db
			.selectFrom("subgraphs")
			.select("name")
			.where("name", "in", [EXPIRED, FRESH, ETERNAL])
			.execute();
		const names = remaining.map((r) => r.name);
		expect(names).not.toContain(EXPIRED);
		expect(names).toContain(FRESH);
		expect(names).toContain(ETERNAL);
	});
});
