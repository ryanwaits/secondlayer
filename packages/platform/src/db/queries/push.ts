import type {
	Database,
	PushPrefs,
	PushSubscription,
} from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

export type PushKind =
	| "webhook_failing"
	| "subgraph_stopped"
	| "subgraph_not_serving"
	| "replay_done"
	| "spend_cap"
	| "key_repeat";

export type PushPrefMap = Record<PushKind, boolean>;

export const PUSH_KINDS: readonly PushKind[] = [
	"webhook_failing",
	"subgraph_stopped",
	"subgraph_not_serving",
	"replay_done",
	"spend_cap",
	"key_repeat",
];

export const PUSH_DEFAULTS: PushPrefMap = {
	webhook_failing: true,
	subgraph_stopped: true,
	subgraph_not_serving: true,
	replay_done: true,
	spend_cap: false,
	key_repeat: false,
};

function toMap(row: PushPrefs): PushPrefMap {
	return {
		webhook_failing: row.webhook_failing,
		subgraph_stopped: row.subgraph_stopped,
		subgraph_not_serving: row.subgraph_not_serving,
		replay_done: row.replay_done,
		spend_cap: row.spend_cap,
		key_repeat: row.key_repeat,
	};
}

export async function getPushPrefs(
	db: Kysely<Database>,
	accountId: string,
): Promise<PushPrefMap> {
	const row = await db
		.selectFrom("push_prefs")
		.selectAll()
		.where("account_id", "=", accountId)
		.executeTakeFirst();
	return row ? toMap(row) : { ...PUSH_DEFAULTS };
}

export async function upsertPushPrefs(
	db: Kysely<Database>,
	accountId: string,
	patch: Partial<PushPrefMap>,
): Promise<PushPrefMap> {
	const changed: Partial<PushPrefMap> = {};
	for (const kind of PUSH_KINDS) {
		const value = patch[kind];
		if (value !== undefined) changed[kind] = value;
	}
	const row = await db
		.insertInto("push_prefs")
		.values({ account_id: accountId, ...changed })
		.onConflict((oc) =>
			oc
				.column("account_id")
				.doUpdateSet({ ...changed, updated_at: new Date() }),
		)
		.returningAll()
		.executeTakeFirstOrThrow();
	return toMap(row);
}

export async function saveSubscription(
	db: Kysely<Database>,
	accountId: string,
	sub: {
		endpoint: string;
		p256dh: string;
		auth: string;
		userAgent: string | null;
	},
): Promise<void> {
	await db
		.insertInto("push_subscriptions")
		.values({
			account_id: accountId,
			endpoint: sub.endpoint,
			p256dh: sub.p256dh,
			auth: sub.auth,
			user_agent: sub.userAgent,
		})
		.onConflict((oc) =>
			oc.column("endpoint").doUpdateSet({
				account_id: accountId,
				p256dh: sub.p256dh,
				auth: sub.auth,
				user_agent: sub.userAgent,
				failed_count: 0,
			}),
		)
		.execute();
}

export async function deleteSubscription(
	db: Kysely<Database>,
	accountId: string,
	endpoint: string,
): Promise<number> {
	const result = await db
		.deleteFrom("push_subscriptions")
		.where("account_id", "=", accountId)
		.where("endpoint", "=", endpoint)
		.executeTakeFirst();
	return Number(result.numDeletedRows);
}

export async function listSubscriptions(
	db: Kysely<Database>,
	accountId: string,
): Promise<PushSubscription[]> {
	return db
		.selectFrom("push_subscriptions")
		.selectAll()
		.where("account_id", "=", accountId)
		.orderBy("created_at")
		.execute();
}

export async function markSent(
	db: Kysely<Database>,
	id: string,
	now: Date,
): Promise<void> {
	await db
		.updateTable("push_subscriptions")
		.set({ last_success_at: now, failed_count: 0 })
		.where("id", "=", id)
		.execute();
}

export const MAX_PUSH_FAILURES = 10;

export async function markFailed(
	db: Kysely<Database>,
	id: string,
): Promise<boolean> {
	const row = await db
		.updateTable("push_subscriptions")
		.set((eb) => ({ failed_count: eb("failed_count", "+", 1) }))
		.where("id", "=", id)
		.returning("failed_count")
		.executeTakeFirst();
	if (!row || row.failed_count < MAX_PUSH_FAILURES) return false;
	await removeSubscription(db, id);
	return true;
}

export async function removeSubscription(
	db: Kysely<Database>,
	id: string,
): Promise<void> {
	await db.deleteFrom("push_subscriptions").where("id", "=", id).execute();
}
