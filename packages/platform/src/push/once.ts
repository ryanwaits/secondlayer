import { logger } from "@secondlayer/shared";
import type { Database } from "@secondlayer/shared/db";
import { type Kysely, sql } from "kysely";
import type { PushKind } from "../db/queries/push.ts";
import { type PushPayload, type SendPushDeps, sendPush } from "./send.ts";

/**
 * Sends a push at most once per (account, key). Claims the key first, so two
 * processes racing on the same signal send once. Never throws. The key stays
 * claimed when the send is skipped (preference off, no phones, VAPID unset):
 * turning a preference on later does not replay old signals.
 */
export async function pushOnce(
	db: Kysely<Database>,
	accountId: string,
	key: string,
	kind: PushKind,
	payload: PushPayload,
	deps: SendPushDeps = {},
): Promise<"sent" | "duplicate" | "skipped"> {
	try {
		const claimed = await db
			.insertInto("push_sent")
			.values({ account_id: accountId, key, kind })
			.onConflict((oc) => oc.columns(["account_id", "key"]).doNothing())
			.returning("key")
			.executeTakeFirst();
		if (!claimed) return "duplicate";
		const result = await sendPush(db, accountId, kind, payload, deps);
		return "skipped" in result ? "skipped" : "sent";
	} catch (err) {
		logger.warn("push.once_failed", {
			kind,
			error: err instanceof Error ? err.message : String(err),
		});
		return "skipped";
	}
}

/** Drops claims older than `olderThanDays`; a key never repeats that late. */
export async function purgePushSent(
	db: Kysely<Database>,
	olderThanDays = 30,
	now: Date = new Date(),
): Promise<number> {
	const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
	const res =
		await sql`DELETE FROM push_sent WHERE sent_at < ${cutoff}`.execute(db);
	return Number(res.numAffectedRows ?? 0);
}
