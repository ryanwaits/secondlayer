import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	BNS_DECODER_NAME,
	deleteBnsName,
	handleBnsReorg,
	upsertBnsName,
	writeBnsNameEvents,
} from "./bns-storage.ts";
import type { BnsNameEventRow } from "./bns-storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H0 = 99_200_001;
const H1 = 99_200_002;
const FQN = "reorg-test.btc";

describe.skipIf(!HAS_DB)("handleBnsReorg projections", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await db.deleteFrom("bns_names").where("fqn", "=", FQN).execute();
		await db
			.deleteFrom("bns_name_events")
			.where("block_height", "in", [H0, H1])
			.execute();
		await db
			.deleteFrom("decoder_checkpoints")
			.where("decoder_name", "=", BNS_DECODER_NAME)
			.execute();
	});

	afterEach(async () => {
		if (!db) return;
		await db.deleteFrom("bns_names").where("fqn", "=", FQN).execute();
		await db
			.deleteFrom("bns_name_events")
			.where("block_height", "in", [H0, H1])
			.execute();
		await db
			.deleteFrom("decoder_checkpoints")
			.where("decoder_name", "=", BNS_DECODER_NAME)
			.execute();
	});

	test("name with events at H-1 and H reconverges to H-1", async () => {
		if (!db) throw new Error("missing test db");
		const older = nameEvent({
			cursor: `${H0}:0`,
			block_height: H0,
			event_index: 0,
			owner: "SP1",
			bns_id: "1",
		});
		const newer = nameEvent({
			cursor: `${H1}:0`,
			block_height: H1,
			event_index: 0,
			owner: "SP2",
			bns_id: "1",
			topic: "transfer-name",
		});
		await writeBnsNameEvents([older, newer], { db });
		await upsertFrom(newer, db);

		const result = await handleBnsReorg(H1, { db });
		expect(result.deleted).toBe(1);
		expect(result.checkpoint).toBe(`${H0}:0`);

		const name = await db
			.selectFrom("bns_names")
			.select(["owner", "last_event_cursor"])
			.where("fqn", "=", FQN)
			.executeTakeFirst();
		expect(name?.owner).toBe("SP1");
		expect(name?.last_event_cursor).toBe(`${H0}:0`);

		const joined = await db
			.selectFrom("bns_names")
			.innerJoin(
				"bns_name_events",
				"bns_name_events.cursor",
				"bns_names.last_event_cursor",
			)
			.select("bns_names.fqn")
			.where("bns_names.fqn", "=", FQN)
			.executeTakeFirst();
		expect(joined?.fqn).toBe(FQN);

		const checkpoint = await db
			.selectFrom("decoder_checkpoints")
			.select("last_cursor")
			.where("decoder_name", "=", BNS_DECODER_NAME)
			.executeTakeFirst();
		expect(checkpoint?.last_cursor).toBe(`${H0}:0`);
	});

	test("name that only exists at H is removed", async () => {
		if (!db) throw new Error("missing test db");
		const only = nameEvent({
			cursor: `${H1}:0`,
			block_height: H1,
			event_index: 0,
			owner: "SP1",
			bns_id: "2",
		});
		await writeBnsNameEvents([only], { db });
		await upsertFrom(only, db);

		await handleBnsReorg(H1, { db });

		const name = await db
			.selectFrom("bns_names")
			.select("fqn")
			.where("fqn", "=", FQN)
			.executeTakeFirst();
		expect(name).toBeUndefined();
	});

	test("orphaned burn restores the pre-fork name", async () => {
		if (!db) throw new Error("missing test db");
		const created = nameEvent({
			cursor: `${H0}:0`,
			block_height: H0,
			event_index: 0,
			owner: "SP1",
			bns_id: "3",
		});
		const burned = nameEvent({
			cursor: `${H1}:0`,
			block_height: H1,
			event_index: 0,
			owner: null,
			bns_id: "3",
			topic: "burn-name",
		});
		await writeBnsNameEvents([created, burned], { db });
		await upsertFrom(created, db);
		await deleteBnsName(FQN, { db });

		await handleBnsReorg(H1, { db });

		const name = await db
			.selectFrom("bns_names")
			.select(["owner", "last_event_cursor"])
			.where("fqn", "=", FQN)
			.executeTakeFirst();
		expect(name?.owner).toBe("SP1");
		expect(name?.last_event_cursor).toBe(`${H0}:0`);
	});
});

async function upsertFrom(
	row: BnsNameEventRow,
	db: NonNullable<ReturnType<typeof getDb>>,
): Promise<void> {
	if (!row.owner) return;
	await upsertBnsName(
		{
			fqn: row.fqn,
			namespace: row.namespace,
			name: row.name,
			owner: row.owner,
			bns_id: row.bns_id,
			registered_at: row.registered_at,
			renewal_height: row.renewal_height,
			last_event_cursor: row.cursor,
			last_event_at: row.block_time,
		},
		{ db },
	);
}

function nameEvent(
	overrides: Partial<BnsNameEventRow> & {
		cursor: string;
		block_height: number;
		event_index: number;
		bns_id: string;
	},
): BnsNameEventRow {
	return {
		cursor: overrides.cursor,
		block_height: overrides.block_height,
		block_time: overrides.block_time ?? new Date("2026-05-01T00:00:00.000Z"),
		tx_id: overrides.tx_id ?? "0xtx",
		tx_index: overrides.tx_index ?? 0,
		event_index: overrides.event_index,
		topic: overrides.topic ?? "new-name",
		namespace: "btc",
		name: "reorg-test",
		fqn: FQN,
		owner: overrides.owner === undefined ? "SP1" : overrides.owner,
		bns_id: overrides.bns_id,
		registered_at: overrides.registered_at ?? overrides.block_height,
		imported_at: null,
		renewal_height: null,
		stx_burn: null,
		preordered_by: null,
		hashed_salted_fqn_preorder: null,
		source_cursor: overrides.source_cursor ?? overrides.cursor,
	};
}
