import { PUSH_RULES, insightPush } from "@secondlayer/platform/push/copy";
import { pushOnce } from "@secondlayer/platform/push/once";
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
	/** Injectable for tests; defaults to the debounced sender. */
	push?: typeof pushOnce;
}

/**
 * One pass over one account: run the account rules over its request log,
 * ledger and caps, then persist under the account's scope. Account insights
 * have a single resource: the account itself. Insights that open this pass and
 * have a push preference (`PUSH_RULES`) also go to the account's phones, once
 * per opened insight. Storage and listing do not depend on the push.
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

	const { opened } = await recordEvaluation(
		db,
		{ accountId },
		fired,
		evaluated,
		now,
	);
	const push = deps.push ?? pushOnce;
	for (const insight of opened) {
		const kind = PUSH_RULES[insight.rule];
		if (!kind) continue;
		await push(
			db,
			accountId,
			`insight:${insight.id}`,
			kind,
			insightPush(insight),
		);
	}
	await purgeResolved(db, { accountId }, 30, now);
}
