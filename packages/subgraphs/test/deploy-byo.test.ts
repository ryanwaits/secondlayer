import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, getRawClientFor } from "@secondlayer/shared/db";
import {
	encryptDatabaseUrl,
	getSubgraph,
	subgraphDatabaseUrl,
} from "@secondlayer/shared/db/queries/subgraphs";
import {
	ByoBreakingChangeError,
	deploySchema,
	renderDeployPlan,
} from "../src/schema/deployer.ts";
import type { SubgraphDefinition } from "../src/types.ts";

// Proves the deploy DDL split: schema/tables land in the user's DB, the registry
// row stays on the managed DB, and breaking changes are refused on BYO.
const SKIP = !process.env.DATABASE_URL;
const USER_DB_URL = "postgresql://postgres:postgres@127.0.0.1:5440/byo_userdb";
const NAME = "deploy-byo-test";
const SCHEMA = "subgraph_deploy_byo_test";

const def: SubgraphDefinition = {
	name: NAME,
	version: "1.0.0",
	sources: { handler: { type: "contract_call", contractId: "SP123::test" } },
	schema: {
		transfers: {
			columns: { sender: { type: "principal" }, amount: { type: "uint" } },
		},
	},
	handlers: { handler: async () => {} },
};

async function schemaExists(url: string | undefined): Promise<boolean> {
	const client = url ? getRawClientFor(url) : getRawClientFor(USER_DB_URL);
	const r =
		await client`SELECT 1 FROM information_schema.schemata WHERE schema_name = ${SCHEMA}`;
	return r.length > 0;
}

describe.skipIf(SKIP)("BYO deploy DDL routing", () => {
	const managed = getDb();
	const acct = "byo-acct-1";

	async function cleanup() {
		await getRawClientFor(USER_DB_URL).unsafe(
			`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`,
		);
		await managed.deleteFrom("subgraphs").where("name", "=", NAME).execute();
		// Schema may have been wrongly created on managed in a failing run — clean.
		await getDb().schema.dropSchema(SCHEMA).ifExists().cascade().execute();
	}

	beforeAll(cleanup);
	afterAll(cleanup);

	test("renderDeployPlan returns DDL + grant script, runs nothing", async () => {
		const plan = renderDeployPlan(def, SCHEMA);
		expect(plan.schemaName).toBe(SCHEMA);
		expect(plan.statements.join("\n")).toContain(
			`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`,
		);
		expect(plan.grantScript).toContain("GRANT");
		expect(plan.dropStatement).toBe(
			`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE;`,
		);
		expect(await schemaExists(USER_DB_URL)).toBe(false);
	});

	test("deploy creates schema in user DB, registry row on managed", async () => {
		const result = await deploySchema(managed, def, "/tmp/h.ts", {
			accountId: acct,
			schemaName: SCHEMA,
			dataDb: getDb(USER_DB_URL),
			databaseUrlEnc: encryptDatabaseUrl(USER_DB_URL),
		});
		expect(result.action).toBe("created");

		// Schema lives in the USER DB...
		expect(await schemaExists(USER_DB_URL)).toBe(true);
		// ...and NOT in the managed DB.
		const inManaged = await getRawClientFor(
			process.env.DATABASE_URL as string,
		)`SELECT 1 FROM information_schema.schemata WHERE schema_name = ${SCHEMA}`;
		expect(inManaged.length).toBe(0);

		// Registry row on managed carries the encrypted url, decrypts back.
		const row = await getSubgraph(managed, NAME, acct);
		if (!row) throw new Error("subgraph row not found");
		expect(row.database_url_enc).toBeInstanceOf(Buffer);
		expect(subgraphDatabaseUrl(row)).toBe(USER_DB_URL);
	});

	test("breaking change on BYO is refused (no destructive DROP on user DB)", async () => {
		const breaking: SubgraphDefinition = {
			...def,
			schema: { transfers: { columns: { sender: { type: "principal" } } } }, // removed `amount`
		};
		const promise = deploySchema(managed, breaking, "/tmp/h.ts", {
			accountId: acct,
			schemaName: SCHEMA,
			dataDb: getDb(USER_DB_URL),
			databaseUrlEnc: encryptDatabaseUrl(USER_DB_URL),
			forceReindex: true,
		});
		await expect(promise).rejects.toThrow(ByoBreakingChangeError);

		const err = (await promise.catch((e) => e)) as ByoBreakingChangeError;
		expect(err.code).toBe("BYO_BREAKING_CHANGE");
		expect(err.details.reasons).toContain(
			"transfers: removed columns [amount]",
		);
		expect(err.details.plan.dropStatement).toBe(
			`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE;`,
		);
		expect(err.details.plan.statements.join("")).toContain("CREATE TABLE");

		// Refusal stands — the user DB schema is untouched.
		expect(await schemaExists(USER_DB_URL)).toBe(true);
	});
});
