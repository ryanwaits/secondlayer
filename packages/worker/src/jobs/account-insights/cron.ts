import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { scheduleCron } from "../cron-schedule.ts";
import { evaluateAccountInsights } from "./evaluate.ts";
import { listActiveAccountIds } from "./load.ts";

const INTERVAL_MS = 5 * 60 * 1000;
const FIRST_TICK_MS = 30_000;
const ACCOUNT_CONCURRENCY = 4;

export interface AccountInsightsCronDeps {
	mode?: () => string;
	listAccounts?: (now: Date) => Promise<string[]>;
	evaluate?: (accountId: string, now: Date) => Promise<void>;
	intervalMs?: number;
	firstTickMs?: number;
}

export async function evaluateActiveAccounts(
	deps: AccountInsightsCronDeps = {},
	now: Date = new Date(),
): Promise<number> {
	const accountIds = await (
		deps.listAccounts ?? ((at) => listActiveAccountIds(getDb(), at))
	)(now);
	const evaluate =
		deps.evaluate ??
		((accountId, at) =>
			evaluateAccountInsights(getDb(), accountId, { now: at }));

	let next = 0;
	const drain = async () => {
		while (next < accountIds.length) {
			const accountId = accountIds[next++];
			if (accountId === undefined) continue;
			try {
				await evaluate(accountId, now);
			} catch (err) {
				logger.warn("insights.account_evaluate_failed", {
					accountId,
					error: getErrorMessage(err),
				});
			}
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(ACCOUNT_CONCURRENCY, accountIds.length) },
			drain,
		),
	);
	return accountIds.length;
}

export function startAccountInsightsCron(
	deps: AccountInsightsCronDeps = {},
): () => void {
	if ((deps.mode ?? getInstanceMode)() !== "platform") {
		logger.info("Account insights cron skipped (not platform mode)");
		return () => {};
	}

	let running = false;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			await evaluateActiveAccounts(deps);
		} catch (err) {
			logger.error("Account insights cron error", {
				error: getErrorMessage(err),
			});
		} finally {
			running = false;
		}
	};

	return scheduleCron(
		tick,
		deps.firstTickMs ?? FIRST_TICK_MS,
		deps.intervalMs ?? INTERVAL_MS,
	);
}
