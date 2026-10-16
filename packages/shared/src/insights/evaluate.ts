import type { Kysely } from "kysely";
import type { Database } from "../db/types.ts";
import { logger } from "../logger.ts";
import { type LabelDeps, maybeLabel } from "./label.ts";
import { listOpenResources, purgeResolved, recordEvaluation } from "./store.ts";
import { SUBGRAPH_RULES, loadSubgraphInputs } from "./subgraph-rules.ts";
import type {
	DetectedInsight,
	EvaluatedKey,
	InsightRule,
	InsightScope,
} from "./types.ts";
import {
	type AbiCache,
	WEBHOOK_RULES,
	createAbiCache,
	loadWebhookInputs,
} from "./webhook-rules.ts";

/**
 * Run one resource's rules. A rule that throws or reports `skip` is left out
 * of `evaluated`, so missing data can never clear an open insight.
 */
export function runRules<Input>(
	rules: InsightRule<Input>[],
	input: Input,
	resource: { kind: EvaluatedKey["kind"]; id: string },
	opts: { active?: boolean } = {},
): { fired: DetectedInsight[]; evaluated: EvaluatedKey[] } {
	const fired: DetectedInsight[] = [];
	const evaluated: EvaluatedKey[] = [];
	for (const rule of rules) {
		try {
			if (rule.skip?.(input)) continue;
			const key = { kind: resource.kind, id: resource.id, rule: rule.id };
			// An inactive resource (a paused webhook) counts as clear.
			const result = opts.active === false ? null : rule.evaluate(input);
			evaluated.push(key);
			if (result) fired.push(result);
		} catch (err) {
			logger.warn("insights.rule_failed", {
				rule: rule.id,
				error: String(err),
			});
		}
	}
	return { fired, evaluated };
}

export interface TenantEvaluateDeps extends Omit<LabelDeps, "now"> {
	now?: Date;
	fetchImpl?: typeof fetch;
	abiCache?: AbiCache;
}

const defaultAbiCache = createAbiCache();

/**
 * One tenant (or self-host) pass: webhook rules, subgraph rules, optional
 * cause labels, then persist. Open insights for resources that no longer
 * exist resolve through the normal two-pass clear.
 */
export async function evaluateTenantInsights(
	db: Kysely<Database>,
	deps: TenantEvaluateDeps = {},
): Promise<void> {
	const now = deps.now ?? new Date();
	const env = deps.env ?? process.env;
	const scope: InsightScope = { accountId: null };

	const webhookInputs = await loadWebhookInputs(db, now, {
		env,
		fetchImpl: deps.fetchImpl ?? fetch,
		cache: deps.abiCache ?? defaultAbiCache,
	});
	const subgraphInputs = await loadSubgraphInputs(db, now);

	const fired: DetectedInsight[] = [];
	const evaluated: EvaluatedKey[] = [];

	for (const input of webhookInputs) {
		const result = runRules(
			WEBHOOK_RULES,
			input,
			{ kind: "webhook", id: input.webhook.id },
			{ active: input.webhook.status !== "paused" },
		);
		fired.push(...result.fired);
		evaluated.push(...result.evaluated);
	}
	for (const input of subgraphInputs) {
		const result = runRules(SUBGRAPH_RULES, input, {
			kind: "subgraph",
			id: input.subgraph.name,
		});
		fired.push(...result.fired);
		evaluated.push(...result.evaluated);
	}

	// Deleted resources: their open rows are evaluated with nothing to fire.
	const live = new Set([
		...webhookInputs.map((i) => `webhook\u0000${i.webhook.id}`),
		...subgraphInputs.map((i) => `subgraph\u0000${i.subgraph.name}`),
	]);
	for (const open of await listOpenResources(db, scope)) {
		if (!live.has(`${open.kind}\u0000${open.id}`)) evaluated.push(open);
	}

	const labelled = await Promise.all(
		fired.map((insight) =>
			maybeLabel(insight, {
				classifyFn: deps.classifyFn,
				cache: deps.cache,
				env,
				now: now.getTime(),
			}),
		),
	);
	await recordEvaluation(db, scope, labelled, evaluated, now);
	await purgeResolved(db, scope, 30, now);
}
