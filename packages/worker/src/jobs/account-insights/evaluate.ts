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
	load?: (accountId: string, now: Date) => Promise<AccountRuleInput>;
	push?: typeof pushOnce;
}

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
