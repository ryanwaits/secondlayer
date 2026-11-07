import { getDb } from "@secondlayer/shared/db";
import { isPlatformMode } from "@secondlayer/shared/mode";
import { keyLiveness } from "../auth/key-state.ts";
import { checkRowsAllowance, isGhostAccount } from "./read-credits.ts";
import { getSlotCounter } from "./slot-counter.ts";

/**
 * Gates for a live SSE connection. The HTTP gates run once when it opens;
 * a stream then serves pages for as long as the caller stays, so the same
 * conditions are re-checked while it runs and the connection is bounded.
 */

/** Live SSE connections one metered account may hold at once. */
export const STREAM_MAX_CONNECTIONS_PER_ACCOUNT = 3;
/** A connection is closed after this long (platform). The SDK reconnects from
 *  its cursor; a raw client does the same with `from_cursor`. */
export const STREAM_MAX_AGE_MS = 15 * 60_000;
/** How often an open connection re-reads the allowance and the key. A paying
 *  account's connection costs two indexed lookups per interval, not per poll. */
export const STREAM_RECHECK_MS = 10_000;
/** Rows served between checks before one is forced early. */
const STREAM_RECHECK_ROWS = 10_000;
/** A slot whose holder died frees itself; outlasts the age limit. */
const STREAM_SLOT_TTL_MS = STREAM_MAX_AGE_MS + 5 * 60_000;

export const STREAM_BUSY_MESSAGE = `An account may hold ${STREAM_MAX_CONNECTIONS_PER_ACCOUNT} live streams at once. Close one and retry.`;

export type StreamTiming = {
	/** Poll cadence of the tail loop. */
	pollMs?: number;
	recheckMs?: number;
	maxAgeMs?: number;
};

type StreamTenant = {
	account_id?: string;
	tier?: string;
	api_key_id?: string;
};

/**
 * Take one of the account's live-connection slots, held until `release`.
 * `"busy"` when it already holds the maximum. Nothing is held for anon,
 * internal or self-host callers.
 */
export async function beginStreamConnection(
	tenant: StreamTenant | undefined,
): Promise<"busy" | { release: () => Promise<void> }> {
	const none = { release: async () => {} };
	if (!isPlatformMode() || !tenant?.account_id || tenant.tier === "internal") {
		return none;
	}
	const release = await getSlotCounter().acquire(
		`sse:${tenant.account_id}`,
		STREAM_MAX_CONNECTIONS_PER_ACCOUNT,
		STREAM_SLOT_TTL_MS,
	);
	return release ? { release } : "busy";
}

/** Why a connection is being ended; `body` goes to the caller in the final
 *  `end` event. */
export type StreamEnd = { reason: string; body: Record<string, unknown> };

async function keyEnd(apiKeyId: string): Promise<StreamEnd | null> {
	const row = await getDb()
		.selectFrom("api_keys")
		.select(["status", "expires_at"])
		.where("id", "=", apiKeyId)
		.executeTakeFirst();
	const state = row ? keyLiveness(row) : "revoked";
	if (state === "live") return null;
	return {
		reason: state === "expired" ? "key_expired" : "key_revoked",
		body: {
			message:
				state === "expired"
					? "This API key has expired. Make a new key at https://secondlayer.tools/account/keys."
					: "This API key was revoked. Make a new key at https://secondlayer.tools/account/keys.",
		},
	};
}

/**
 * The per-connection checker. Call `check(rowsJustServed)` before each poll:
 * it returns the reason to end the stream, or `null` to carry on.
 *
 * - Age: past `maxAgeMs` (platform only; a self-hosted operator's stream
 *   runs as long as they like).
 * - Allowance, spend cap, ghost row limit, key liveness: re-read every
 *   `recheckMs`, or sooner after `STREAM_RECHECK_ROWS` rows. A ghost (docs
 *   key) is re-read after every page that served rows, since its whole budget
 *   is 100k rows.
 */
export function createStreamGuard(
	tenant: StreamTenant | undefined,
	timing: StreamTiming = {},
	now: () => number = Date.now,
) {
	const recheckMs = timing.recheckMs ?? STREAM_RECHECK_MS;
	const maxAgeMs = timing.maxAgeMs ?? STREAM_MAX_AGE_MS;
	const startedAt = now();
	let lastCheckAt = startedAt;
	let rowsSinceCheck = 0;

	return {
		async check(rowsJustServed: number): Promise<StreamEnd | null> {
			rowsSinceCheck += rowsJustServed;
			const at = now();
			if (isPlatformMode() && at - startedAt >= maxAgeMs) {
				return {
					reason: "max_age",
					body: {
						message: `Streams close after ${Math.round(maxAgeMs / 60_000)} minutes. Reconnect from your last cursor.`,
						reconnect: true,
					},
				};
			}
			if (!tenant) return null;
			const meteredId =
				isPlatformMode() && tenant.tier !== "internal"
					? tenant.account_id
					: undefined;
			if (!meteredId && !tenant.api_key_id) return null;

			const ghost =
				meteredId !== undefined &&
				rowsSinceCheck > 0 &&
				(await isGhostAccount(meteredId));
			const due =
				at - lastCheckAt >= recheckMs ||
				rowsSinceCheck >= STREAM_RECHECK_ROWS ||
				ghost;
			if (!due) return null;
			lastCheckAt = at;
			rowsSinceCheck = 0;

			if (tenant.api_key_id) {
				const ended = await keyEnd(tenant.api_key_id);
				if (ended) return ended;
			}
			if (meteredId) {
				const refusal = await checkRowsAllowance(meteredId, tenant.tier);
				if (refusal) return { reason: refusal.error, body: { ...refusal } };
			}
			return null;
		},
	};
}
