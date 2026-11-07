import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { getDb } from "./index.ts";
import { casTransition, defineMachine } from "./transition.ts";

const lights = defineMachine({
	states: ["red", "green", "yellow"],
	transitions: { red: ["green"], green: ["yellow"], yellow: ["red"] },
});

describe("defineMachine", () => {
	test("allows a listed move and rejects an unlisted one", () => {
		expect(lights.canTransition("red", "green")).toBe(true);
		expect(lights.canTransition("red", "yellow")).toBe(false);
		expect(lights.canTransition("green", "green")).toBe(false);
	});

	test("assert throws on an illegal move and passes a legal one", () => {
		expect(() => lights.assert("red", "yellow")).toThrow(
			"illegal transition red -> yellow",
		);
		expect(() => lights.assert("red", "green")).not.toThrow();
	});

	test("a state with no entry has no outgoing moves", () => {
		const m = defineMachine({
			states: ["open", "closed"],
			transitions: { open: ["closed"] },
		});
		expect(m.canTransition("closed", "open")).toBe(false);
	});
});

const SKIP = !process.env.DATABASE_URL;
const TABLE = `cas_transition_test_${process.pid}`;

describe.skipIf(SKIP)("casTransition", () => {
	const db = getDb();

	beforeAll(async () => {
		await sql`
			CREATE TABLE ${sql.table(TABLE)} (
				id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				status text NOT NULL,
				note text,
				updated_at timestamptz NOT NULL DEFAULT '2020-01-01'
			)
		`.execute(db);
	});

	afterAll(async () => {
		await sql`DROP TABLE IF EXISTS ${sql.table(TABLE)}`.execute(db);
	});

	async function insert(status: string): Promise<string> {
		const { rows } = await sql<{ id: string }>`
			INSERT INTO ${sql.table(TABLE)} (status) VALUES (${status}) RETURNING id
		`.execute(db);
		return rows[0]?.id as string;
	}

	test("moves a row in a from state, writes extra columns and stamps updated_at", async () => {
		const id = await insert("pending");
		const row = await casTransition<"pending" | "running", { status: string }>(
			db,
			{
				table: TABLE,
				id,
				from: ["pending"],
				to: "running",
				set: { note: "claimed" },
			},
		);
		expect(row).toMatchObject({ status: "running", note: "claimed" });
		expect(
			(row as unknown as { updated_at: Date }).updated_at.getFullYear(),
		).toBeGreaterThan(2020);
	});

	test("returns null and leaves the row when it is not in a from state", async () => {
		const id = await insert("done");
		const row = await casTransition(db, {
			table: TABLE,
			id,
			from: ["pending", "running"],
			to: "running",
		});
		expect(row).toBeNull();
		const { rows } = await sql<{ status: string }>`
			SELECT status FROM ${sql.table(TABLE)} WHERE id = ${id}
		`.execute(db);
		expect(rows[0]?.status).toBe("done");
	});

	test("of two concurrent claims only one wins", async () => {
		const id = await insert("pending");
		const results = await Promise.all(
			[1, 2].map(() =>
				casTransition(db, {
					table: TABLE,
					id,
					from: ["pending"],
					to: "running",
				}),
			),
		);
		expect(results.filter((r) => r !== null)).toHaveLength(1);
	});

	test("returns null for a missing row", async () => {
		const row = await casTransition(db, {
			table: TABLE,
			id: crypto.randomUUID(),
			from: ["pending"],
			to: "running",
		});
		expect(row).toBeNull();
	});

	test("works inside a transaction and rolls back with it", async () => {
		const id = await insert("pending");
		await db
			.transaction()
			.execute(async (trx) => {
				const row = await casTransition(trx, {
					table: TABLE,
					id,
					from: ["pending"],
					to: "running",
				});
				expect(row).not.toBeNull();
				throw new Error("abort");
			})
			.catch(() => {});
		const { rows } = await sql<{ status: string }>`
			SELECT status FROM ${sql.table(TABLE)} WHERE id = ${id}
		`.execute(db);
		expect(rows[0]?.status).toBe("pending");
	});

	test("uses a custom column and skips updated_at when told to", async () => {
		await sql`
			ALTER TABLE ${sql.table(TABLE)} ADD COLUMN IF NOT EXISTS phase text DEFAULT 'a'
		`.execute(db);
		const id = await insert("pending");
		const row = await casTransition<string, { phase: string }>(db, {
			table: TABLE,
			id,
			column: "phase",
			from: ["a"],
			to: "b",
			stampUpdatedAt: false,
		});
		expect(row?.phase).toBe("b");
		expect(
			(row as unknown as { updated_at: Date }).updated_at.getFullYear(),
		).toBe(2020);
	});
});
