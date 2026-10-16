import type { Database } from "@secondlayer/shared/db";
import {
	purgeResolved,
	recordEvaluation,
	runRules,
} from "@secondlayer/shared/insights";
import type { Kysely } from "kysely";
import { loadAccountInput } from "./load.ts";
import { ACCOUNT_RULES, type AccountRuleInput } from "./rules.ts";

export interface AccountEvaluateDeps {
	now?: Date;
	/** Injectable for tests; defaults to the platform database queries. */
	load?: (accountId: string, now: Date) => Promise<AccountRuleInput>;
}

/**
 * One pass over one account: run the account rules over its request log,
 * ledger and caps, then persist under the account's scope. Account insights
 * have a single resource: the account itself.
 */
export async function evaluateAccountInsights(
	db: Kysely<Database>,
	accountId: string,
	deps: AccountEvaluateDeps = {},
): Promise<void> {
	const now = deps.now ?? new Date();
	const input = await (deps.load ?? ((id, at) => loadAccountInput(db, id, at)))(
		accountId,
		now,
	);
	const { fired, evaluated } = runRules(ACCOUNT_RULES, input, {
		kind: "account",
		id: "account",
	});

	await recordEvaluation(db, { accountId }, fired, evaluated, now);
	await purgeResolved(db, { accountId }, 30, now);
}
