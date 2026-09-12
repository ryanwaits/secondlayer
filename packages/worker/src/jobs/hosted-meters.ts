/**
 * Daily hosted-subgraph running + storage meters.
 *
 * Running: $0.10/day for each subgraph with status active or reindexing
 * and a non-empty account_id. Storage: $0.50/GB-month prorated daily for
 * every subgraph that still holds disk (including error and paused).
 * Idempotent via hosted_meter_days INSERT ON CONFLICT DO NOTHING.
 * Running-fee shortfall pauses the subgraph. Storage shortfall is logged
 * and skipped; disk is not deleted. No-op in non-platform mode.
 */

import {
	RUNNING_USD_MICROS_PER_DAY,
	debitHostedMeter,
	storageDailyCost,
} from "@secondlayer/platform/hosted-meters";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import {
	pauseSubgraph,
	pgSchemaName,
} from "@secondlayer/shared/db/queries/subgraphs";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { sql } from "kysely";

const INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startHostedMetersCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Hosted meters cron skipped (not platform mode)");
		return () => {};
	}

	const tick = async () => {
		try {
			await runHostedMeterDay();
		} catch (err) {
			logger.error("Hosted meters cron error", {
				error: getErrorMessage(err),
			});
		}
	};

	const initial = setTimeout(tick, 15 * 60_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}

export async function runHostedMeterDay(now = new Date()): Promise<void> {
	const day = now.toISOString().slice(0, 10);
	const db = getDb();

	const subgraphs = await db
		.selectFrom("subgraphs")
		.select(["name", "account_id", "schema_name", "status"])
		.where("account_id", "<>", "")
		.execute();

	for (const sg of subgraphs) {
		if (sg.status !== "active" && sg.status !== "reindexing") continue;
		try {
			const inserted = await db
				.insertInto("hosted_meter_days")
				.values({
					day,
					account_id: sg.account_id,
					subgraph_name: sg.name,
					kind: "running",
					usd_micros: RUNNING_USD_MICROS_PER_DAY.toString(),
				})
				.onConflict((oc) =>
					oc
						.columns(["day", "account_id", "subgraph_name", "kind"])
						.doNothing(),
				)
				.returning("subgraph_name")
				.executeTakeFirst();
			if (inserted) {
				const ok = await debitHostedMeter(
					db,
					sg.account_id,
					RUNNING_USD_MICROS_PER_DAY,
				);
				if (!ok) await pauseSubgraph(db, sg.name, sg.account_id);
			}
		} catch (err) {
			logger.warn("hosted running meter failed", {
				subgraph: sg.name,
				accountId: sg.account_id,
				error: getErrorMessage(err),
			});
		}
	}

	const sizes = await sql<{
		schema: string;
		bytes: string | number | bigint | null;
	}>`
		SELECT n.nspname AS schema, SUM(pg_total_relation_size(c.oid))::bigint AS bytes
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname LIKE 'subgraph_%' AND c.relkind IN ('r','i','m','p')
		GROUP BY n.nspname
	`.execute(db);

	const bytesBySchema = new Map<string, bigint>();
	for (const row of sizes.rows) {
		bytesBySchema.set(row.schema, BigInt(row.bytes ?? 0));
	}

	for (const sg of subgraphs) {
		try {
			const schema = sg.schema_name ?? pgSchemaName(sg.name);
			const bytes = bytesBySchema.get(schema) ?? 0n;
			const cost = storageDailyCost(bytes);
			const inserted = await db
				.insertInto("hosted_meter_days")
				.values({
					day,
					account_id: sg.account_id,
					subgraph_name: sg.name,
					kind: "storage",
					usd_micros: cost.toString(),
				})
				.onConflict((oc) =>
					oc
						.columns(["day", "account_id", "subgraph_name", "kind"])
						.doNothing(),
				)
				.returning("subgraph_name")
				.executeTakeFirst();
			if (inserted && cost > 0n) {
				const ok = await debitHostedMeter(db, sg.account_id, cost);
				if (!ok) {
					logger.warn("hosted storage meter skipped (insufficient credits)", {
						subgraph: sg.name,
						accountId: sg.account_id,
					});
				}
			}
		} catch (err) {
			logger.warn("hosted storage meter failed", {
				subgraph: sg.name,
				accountId: sg.account_id,
				error: getErrorMessage(err),
			});
		}
	}
}
