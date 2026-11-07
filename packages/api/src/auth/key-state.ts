import type { ApiKeyStatus } from "@secondlayer/shared/db";
import {
	type Expression,
	type ExpressionBuilder,
	type SqlBool,
	sql,
} from "kysely";

/** Stored states of `api_keys.status`, mirrored by `api_keys_status_check`. */
export const KEY_STATES = [
	"active",
	"revoked",
] as const satisfies readonly ApiKeyStatus[];

/** What a key is right now: `expired` is derived from `expires_at`, never stored. */
export type KeyLiveness = "live" | "revoked" | "expired";

type KeyRow = { status: ApiKeyStatus; expires_at?: Date | null };

/** The one definition of "this key may authenticate". Every reader goes
 *  through here (or `liveKeyWhere`, its SQL twin); no inline copies. */
export function keyLiveness(row: KeyRow, now: Date = new Date()): KeyLiveness {
	if (row.status !== "active") return "revoked";
	if (row.expires_at && row.expires_at.getTime() <= now.getTime()) {
		return "expired";
	}
	return "live";
}

export function isKeyLive(row: KeyRow, now: Date = new Date()): boolean {
	return keyLiveness(row, now) === "live";
}

/** Not past `expires_at`, whatever the status (a key list hides expired keys
 *  but still shows revoked ones). Without `now` the database clock decides. */
export function notExpiredWhere(now?: Date) {
	return (
		// biome-ignore lint/suspicious/noExplicitAny: used against api_keys from any query shape
		eb: ExpressionBuilder<any, any>,
	): Expression<SqlBool> => {
		const at = now ?? sql<Date>`now()`;
		return eb.or([eb("expires_at", "is", null), eb("expires_at", ">", at)]);
	};
}

/** SQL twin of `isKeyLive` for `api_keys`, as a `.where(...)` callback:
 *  active and not expired. */
export function liveKeyWhere(now?: Date) {
	return (
		// biome-ignore lint/suspicious/noExplicitAny: used against api_keys from any query shape
		eb: ExpressionBuilder<any, any>,
	): Expression<SqlBool> =>
		eb.and([eb("status", "=", "active"), notExpiredWhere(now)(eb)]);
}
