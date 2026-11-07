/**
 * Tells the platform each hosted stack's real state. The control DB's
 * `tenants.state` + `stop_reason` is the source; the platform keeps a copy in
 * `hosted_stack_state` (`POST /internal/stack-state`).
 *
 * Two triggers, one sender:
 *  - `schedule(accountId)`: after a tenant changes. Debounced per account, so
 *    a start that fires several changes sends one report with the final row.
 *  - `reconcile()`: every tenant, on each credits poll tick (and at boot).
 *    It is also the retry: a failed report is simply sent again next tick.
 *
 * A report never throws and never blocks a start or stop. Each report is
 * stamped with the time just before its row was read; the platform ignores a
 * report older than the one it holds.
 */

import { logger } from "@secondlayer/shared";
import type postgres from "postgres";
import {
	type StopReason,
	type TenantRow,
	type TenantState,
	getTenant,
	listTenants,
} from "./control-db.ts";
import type { FetchLike } from "./fetch-like.ts";

const POST_TIMEOUT_MS = 5_000;
/** Matches the route's per-call cap. */
const MAX_BATCH = 500;
export const STACK_STATE_DEBOUNCE_MS = 2_000;

export interface StackStatePlatform {
	appServerUrl: string;
	workloadHostKey: string;
}

export interface StackStateReport {
	account_id: string;
	state: TenantState;
	stop_reason: StopReason | null;
	observed_at: string;
}

export interface StackStateReporter {
	/** Report this account after a short quiet period. */
	schedule(accountId: string): void;
	/** Report every tenant. Resolves true when every batch was accepted. */
	reconcile(): Promise<boolean>;
	/** Cancel pending debounced reports (shutdown). */
	stop(): void;
}

/** A tenant row without a row (a failed provision deletes its row) is a
 *  stack that does not exist: reported as `destroyed`, which the platform
 *  reads as `none`. */
function toReport(
	accountId: string,
	row: Pick<TenantRow, "state" | "stop_reason"> | null,
	observedAt: Date,
): StackStateReport {
	return {
		account_id: accountId,
		state: row?.state ?? "destroyed",
		stop_reason: row?.state === "stopped" ? row.stop_reason : null,
		observed_at: observedAt.toISOString(),
	};
}

async function postStates(
	platform: StackStatePlatform,
	states: StackStateReport[],
	doFetch: FetchLike,
): Promise<boolean> {
	for (let i = 0; i < states.length; i += MAX_BATCH) {
		try {
			const res = await doFetch(
				`${platform.appServerUrl.replace(/\/+$/, "")}/internal/stack-state`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${platform.workloadHostKey}`,
					},
					body: JSON.stringify({ states: states.slice(i, i + MAX_BATCH) }),
					signal: AbortSignal.timeout(POST_TIMEOUT_MS),
				},
			);
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`app-server ${res.status} ${text.slice(0, 200)}`);
			}
		} catch (err) {
			logger.warn("workload.stack_state.post_failed", {
				count: states.length,
				error: err instanceof Error ? err.message : String(err),
			});
			return false;
		}
	}
	return true;
}

export function createStackStateReporter(
	db: postgres.Sql,
	platform: StackStatePlatform,
	deps: {
		fetchImpl?: FetchLike;
		now?: () => Date;
		debounceMs?: number;
	} = {},
): StackStateReporter {
	const doFetch = deps.fetchImpl ?? fetch;
	const now = deps.now ?? (() => new Date());
	const debounceMs = deps.debounceMs ?? STACK_STATE_DEBOUNCE_MS;
	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	async function reportAccount(accountId: string): Promise<void> {
		try {
			const observedAt = now();
			const row = await getTenant(db, accountId);
			await postStates(
				platform,
				[toReport(accountId, row ?? null, observedAt)],
				doFetch,
			);
		} catch (err) {
			logger.warn("workload.stack_state.report_failed", {
				accountId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return {
		schedule(accountId) {
			const pending = timers.get(accountId);
			if (pending) clearTimeout(pending);
			timers.set(
				accountId,
				setTimeout(() => {
					timers.delete(accountId);
					void reportAccount(accountId);
				}, debounceMs),
			);
		},
		async reconcile() {
			try {
				const observedAt = now();
				const rows = await listTenants(db);
				return await postStates(
					platform,
					rows.map((row) => toReport(row.account_id, row, observedAt)),
					doFetch,
				);
			} catch (err) {
				logger.warn("workload.stack_state.reconcile_failed", {
					error: err instanceof Error ? err.message : String(err),
				});
				return false;
			}
		},
		stop() {
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
		},
	};
}
