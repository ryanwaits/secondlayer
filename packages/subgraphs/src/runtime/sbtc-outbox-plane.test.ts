import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import type { Kysely } from "kysely";
import { emitSbtcOutbox } from "./trigger-evaluator.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

/**
 * Wrap a db handle so any `selectFrom("sbtc_events")` throws. `sbtc_events` is a
 * SOURCE-plane table; the evaluator runs on the TARGET handle. emitSbtcOutbox
 * must read the decoded rows from the source plane (getSourceDb), not the handle
 * passed for the outbox WRITE — reading off the target silently matched zero rows
 * under the live split, so sBTC webhooks never fired. This guard fails loudly if
 * the source read ever regresses back onto the passed handle.
 */
function blockSbtcSelect(real: Kysely<Database>): Kysely<Database> {
	return new Proxy(real, {
		get(target, prop, receiver) {
			if (prop === "selectFrom") {
				return (table: unknown, ...rest: unknown[]) => {
					if (table === "sbtc_events") {
						throw new Error(
							"emitSbtcOutbox read sbtc_events off the passed (target) handle — must read the source plane",
						);
					}
					return (target.selectFrom as unknown as (...a: unknown[]) => unknown)(
						table,
						...rest,
					);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as Kysely<Database>;
}

let db: Kysely<Database>;
let accountId: string;

beforeAll(() => {
	db = getDb();
	accountId = randomUUID();
});

afterAll(async () => {
	await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", accountId)
		.execute();
	await db
		.deleteFrom("sbtc_events")
		.where("tx_id", "=", "0xplane-acc")
		.execute();
});

describe("emitSbtcOutbox plane safety", () => {
	it("reads sbtc_events from the source plane, not the outbox (target) handle", async () => {
		const { subscription } = await createSubscription(db, {
			accountId,
			kind: "chain",
			name: `sbtc-plane-${randomUUID().slice(0, 8)}`,
			url: "https://webhook.site/xxx",
			triggers: [{ type: "sbtc_withdrawal_accept" }],
		});

		await db
			.insertInto("sbtc_events")
			.values({
				cursor: "990000:0",
				block_height: 990_000,
				block_time: new Date("2026-06-01T00:00:00.000Z"),
				tx_id: "0xplane-acc",
				tx_index: 0,
				event_index: 0,
				topic: "withdrawal-accept",
				request_id: 4242,
				sweep_txid: "0xplanesweep",
				source_cursor: "990000:0",
			})
			.execute();

		// Pass the GUARDED handle as the (target) write handle and omit sourceDb so
		// the read falls to the real getSourceDb() default. If the read regresses
		// onto the passed handle, the proxy throws.
		const emitted = await emitSbtcOutbox(
			blockSbtcSelect(db),
			[subscription],
			990_000,
			"0xblockhash",
		);
		expect(emitted).toBe(1);

		const rows = await db
			.selectFrom("subscription_outbox")
			.select("event_type")
			.where("subscription_id", "=", subscription.id)
			.execute();
		expect(rows).toHaveLength(1);
	});
});
