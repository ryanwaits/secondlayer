import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { up as up0001 } from "../migrations/0001_initial.ts";
import { up as up0082 } from "../migrations/0082_contracts_registry.ts";
import {
	listContractsByTrait,
	markContractsNonCanonical,
	recordContractDeploy,
	setContractAbi,
} from "../src/db/queries/contracts.ts";
import type { Database } from "../src/db/types.ts";

const HAS_DB = !!process.env.DATABASE_URL;

async function withSchema(run: (db: Kysely<Database>) => Promise<void>) {
	if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");
	const schema = `contracts_cls_${Date.now().toString(36)}`;
	const client = postgres(process.env.DATABASE_URL, { max: 1 });
	const db = new Kysely<Database>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});
	try {
		await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
		await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);
		await up0001(db);
		await up0082(db);
		await run(db);
	} finally {
		await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
		await db.destroy();
	}
}

async function classify(
	db: Kysely<Database>,
	id: string,
	height: number,
	at: string,
) {
	await recordContractDeploy(db, {
		contractId: id,
		deployer: "SP1",
		blockHeight: height,
	});
	await setContractAbi(db, id, {
		abi: { functions: [] },
		status: "fetched",
		declaredTraits: ["sip-010"],
	});
	await sql`UPDATE contracts SET abi_fetched_at = ${at}::timestamptz WHERE contract_id = ${id}`.execute(
		db,
	);
}

describe.skipIf(!HAS_DB)("contract discovery classified_after", () => {
	test("returns only contracts classified at or after the given time", async () => {
		await withSchema(async (db) => {
			await classify(db, "SP1.early", 10, "2026-10-15T10:00:00Z");
			await classify(db, "SP1.late", 20, "2026-10-15T11:00:00Z");

			const all = await listContractsByTrait(db, "sip-010");
			expect(all.map((c) => c.contract_id)).toEqual(["SP1.early", "SP1.late"]);

			const since = await listContractsByTrait(db, "sip-010", {
				classifiedAfter: new Date("2026-10-15T11:00:00Z"),
			});
			expect(since.map((c) => c.contract_id)).toEqual(["SP1.late"]);
		});
	});

	test("still requires the trait and canonical", async () => {
		await withSchema(async (db) => {
			await classify(db, "SP1.token", 10, "2026-10-15T12:00:00Z");
			await classify(db, "SP1.reorged", 50, "2026-10-15T12:00:00Z");
			await recordContractDeploy(db, {
				contractId: "SP1.other",
				deployer: "SP1",
				blockHeight: 11,
			});
			await setContractAbi(db, "SP1.other", {
				abi: { functions: [] },
				status: "fetched",
				declaredTraits: ["sip-009"],
			});
			await markContractsNonCanonical(db, 50);

			const since = await listContractsByTrait(db, "sip-010", {
				classifiedAfter: new Date("2026-10-15T00:00:00Z"),
			});
			expect(since.map((c) => c.contract_id)).toEqual(["SP1.token"]);
		});
	});
});
