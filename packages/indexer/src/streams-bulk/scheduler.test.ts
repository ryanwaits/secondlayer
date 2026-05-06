import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	publishNextEligibleRange,
	startStreamsBulkPublisher,
	streamsBulkPublisherState,
} from "./scheduler.ts";

describe("startStreamsBulkPublisher gating", () => {
	test("returns a no-op stop fn when STREAMS_BULK_PUBLISHER_ENABLED is unset", () => {
		const previous = process.env.STREAMS_BULK_PUBLISHER_ENABLED;
		delete process.env.STREAMS_BULK_PUBLISHER_ENABLED;
		try {
			const stop = startStreamsBulkPublisher();
			expect(typeof stop).toBe("function");
			expect(streamsBulkPublisherState.enabled).toBe(false);
			stop();
		} finally {
			if (previous !== undefined) {
				process.env.STREAMS_BULK_PUBLISHER_ENABLED = previous;
			}
		}
	});

	test("returns a no-op when env is set to anything other than 'true'", () => {
		const previous = process.env.STREAMS_BULK_PUBLISHER_ENABLED;
		process.env.STREAMS_BULK_PUBLISHER_ENABLED = "false";
		try {
			const stop = startStreamsBulkPublisher();
			stop();
			expect(streamsBulkPublisherState.enabled).toBe(false);
		} finally {
			if (previous === undefined) {
				delete process.env.STREAMS_BULK_PUBLISHER_ENABLED;
			} else {
				process.env.STREAMS_BULK_PUBLISHER_ENABLED = previous;
			}
		}
	});
});

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("publishNextEligibleRange (DB-gated)", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	afterEach(async () => {
		if (!db) return;
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	test("returns null when no canonical blocks exist", async () => {
		const range = await publishNextEligibleRange();
		expect(range).toBeNull();
	});

	test("returns null when tip is below the first finalized range boundary", async () => {
		if (!db) throw new Error("missing test db");
		await db
			.insertInto("blocks")
			.values([
				{
					height: 1,
					hash: "0x01",
					parent_hash: "0x00",
					burn_block_height: 101,
					timestamp: 1_000,
					canonical: true,
				},
			])
			.execute();
		const range = await publishNextEligibleRange();
		expect(range).toBeNull();
	});
});
