import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { notifyReindexComplete } from "./reindex-notify.ts";

const priorMode = process.env.INSTANCE_MODE;

afterEach(() => {
	if (priorMode === undefined)
		Reflect.deleteProperty(process.env, "INSTANCE_MODE");
	else process.env.INSTANCE_MODE = priorMode;
});

/** A db that records the tables it is asked about and finds nothing. */
function recordingDb() {
	const tables: string[] = [];
	const chain = {
		select: () => chain,
		where: () => chain,
		executeTakeFirst: async () => undefined,
	};
	const db = {
		selectFrom: (table: string) => {
			tables.push(table);
			return chain;
		},
	} as unknown as Kysely<Database>;
	return { db, tables };
}

const stats = { blocks: 10, events: 2, errors: 0 };

describe("notifyReindexComplete", () => {
	test("an instance has no accounts: it never queries for one", async () => {
		process.env.INSTANCE_MODE = "oss";
		const { db, tables } = recordingDb();

		await notifyReindexComplete(db, "my-subgraph", stats);

		expect(tables).toEqual([]);
	});

	test("the platform looks the owning account up", async () => {
		process.env.INSTANCE_MODE = "platform";
		const { db, tables } = recordingDb();

		await notifyReindexComplete(db, "my-subgraph", stats);

		expect(tables).toEqual(["subgraphs"]);
	});
});
