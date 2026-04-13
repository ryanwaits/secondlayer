import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { sql } from "kysely";
import { getDb } from "../src/db/index.ts";
import { upsertWorkflowDefinition } from "../src/db/queries/workflows.ts";
import { VersionConflictError } from "../src/errors.ts";

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("upsertWorkflowDefinition", () => {
	let apiKeyId: string;

	beforeAll(async () => {
		const db = getDb();
		const acct = await db
			.insertInto("accounts")
			.values({ email: "wf-upsert-test@example.com" })
			.returningAll()
			.executeTakeFirstOrThrow();
		const key = await db
			.insertInto("api_keys")
			.values({
				account_id: acct.id,
				key_hash: `test-${Date.now()}`,
				key_prefix: `sk_test_${Date.now().toString().slice(-6)}`,
				ip_address: "127.0.0.1",
				name: "wf-upsert-test",
			})
			.returningAll()
			.executeTakeFirstOrThrow();
		apiKeyId = key.id;
	});

	afterEach(async () => {
		const db = getDb();
		await db
			.deleteFrom("workflow_definitions")
			.where("api_key_id", "=", apiKeyId)
			.execute();
	});

	afterAll(async () => {
		const db = getDb();
		await db.deleteFrom("api_keys").where("id", "=", apiKeyId).execute();
		await sql`DELETE FROM accounts WHERE email = 'wf-upsert-test@example.com'`.execute(
			db,
		);
	});

	test("inserts new definition at 1.0.0 with sourceCode", async () => {
		const db = getDb();
		const def = await upsertWorkflowDefinition(db, {
			name: "wf-a",
			triggerType: "manual",
			triggerConfig: { type: "manual" },
			handlerPath: "/tmp/wf-a.js",
			apiKeyId,
			sourceCode: "export default { name: 'wf-a' };",
		});

		expect(def.version).toBe("1.0.0");
		expect(def.source_code).toBe("export default { name: 'wf-a' };");
	});

	test("bumps patch version on update", async () => {
		const db = getDb();
		await upsertWorkflowDefinition(db, {
			name: "wf-b",
			triggerType: "manual",
			triggerConfig: { type: "manual" },
			handlerPath: "/tmp/wf-b.js",
			apiKeyId,
			sourceCode: "v1",
		});
		const updated = await upsertWorkflowDefinition(db, {
			name: "wf-b",
			triggerType: "manual",
			triggerConfig: { type: "manual" },
			handlerPath: "/tmp/wf-b.js",
			apiKeyId,
			sourceCode: "v2",
		});

		expect(updated.version).toBe("1.0.1");
		expect(updated.source_code).toBe("v2");
	});

	test("throws VersionConflictError on expectedVersion mismatch", async () => {
		const db = getDb();
		await upsertWorkflowDefinition(db, {
			name: "wf-c",
			triggerType: "manual",
			triggerConfig: { type: "manual" },
			handlerPath: "/tmp/wf-c.js",
			apiKeyId,
		});

		await expect(
			upsertWorkflowDefinition(db, {
				name: "wf-c",
				triggerType: "manual",
				triggerConfig: { type: "manual" },
				handlerPath: "/tmp/wf-c.js",
				apiKeyId,
				expectedVersion: "9.9.9",
			}),
		).rejects.toBeInstanceOf(VersionConflictError);
	});

	test("accepts any current version when expectedVersion omitted", async () => {
		const db = getDb();
		await upsertWorkflowDefinition(db, {
			name: "wf-d",
			triggerType: "manual",
			triggerConfig: { type: "manual" },
			handlerPath: "/tmp/wf-d.js",
			apiKeyId,
		});
		const bumped = await upsertWorkflowDefinition(db, {
			name: "wf-d",
			triggerType: "manual",
			triggerConfig: { type: "manual" },
			handlerPath: "/tmp/wf-d.js",
			apiKeyId,
		});
		expect(bumped.version).toBe("1.0.1");
	});
});
