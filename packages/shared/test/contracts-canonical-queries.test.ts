import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { up as up0001 } from "../migrations/0001_initial.ts";
import { up as up0082 } from "../migrations/0082_contracts_registry.ts";
import {
	getContract,
	markContractsNonCanonical,
	recordContractDeploy,
	setContractAbi,
} from "../src/db/queries/contracts.ts";
import type { Database } from "../src/db/types.ts";

const HAS_DB = !!process.env.DATABASE_URL;

// The contracts-registry reorg contract (CANON-01): handleReorg flips rows
// >= fork height non-canonical; canonical-filtered reads then exclude them;
// re-recording a deploy found on the new fork re-canonicalizes the row with
// its new height while keeping the already-fetched ABI.
describe.skipIf(!HAS_DB)("contracts canonical round trip", () => {
	test("mark non-canonical → hidden from getContract → re-record restores", async () => {
		if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");

		const schema = `contracts_canon_${Date.now().toString(36)}`;
		const client = postgres(process.env.DATABASE_URL, { max: 1 });
		const db = new Kysely<Database>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});

		try {
			await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
			await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);
			await up0001(db);
			await up0082(db);

			await recordContractDeploy(db, {
				contractId: "SP1.token",
				deployer: "SP1",
				blockHeight: 100,
			});
			await recordContractDeploy(db, {
				contractId: "SP2.older",
				deployer: "SP2",
				blockHeight: 50,
			});
			await setContractAbi(db, "SP1.token", {
				abi: { functions: [] },
				status: "fetched",
				declaredTraits: ["sip-010"],
			});

			await markContractsNonCanonical(db, 100);

			// At/above the fork point: hidden from the by-id read.
			expect(await getContract(db, "SP1.token")).toBeNull();
			// Below the fork point: untouched.
			const older = await getContract(db, "SP2.older");
			expect(older?.canonical).toBe(true);

			// Deploy re-discovered on the new fork at a different height:
			// re-canonicalized, height updated, fetched ABI preserved.
			await recordContractDeploy(db, {
				contractId: "SP1.token",
				deployer: "SP1",
				blockHeight: 102,
			});
			const restored = await getContract(db, "SP1.token");
			expect(restored?.canonical).toBe(true);
			expect(Number(restored?.block_height)).toBe(102);
			expect(restored?.abi_status).toBe("fetched");
			expect(restored?.declared_traits).toEqual(["sip-010"]);
		} finally {
			await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
			await db.destroy();
		}
	});
});
