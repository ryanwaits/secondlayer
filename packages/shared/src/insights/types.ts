import type { Insight } from "../schemas/insights.ts";

/** What a rule returns: an `Insight` before the store assigns identity and time. */
export type DetectedInsight = Omit<Insight, "id" | "createdAt" | "resolvedAt">;

/** One (resource, rule) pair a pass actually looked at. */
export interface EvaluatedKey {
	kind: Insight["resource"]["kind"];
	id: string;
	rule: string;
}

/** `null` on tenant and self-host databases, the account id on the platform. */
export interface InsightScope {
	accountId: string | null;
}

/**
 * A pure rule over plain inputs. Returns null when it does not fire.
 * `skip` returns true when the input lacks the data the rule needs (a failed
 * ABI fetch, no health snapshots yet): a skipped rule fires nothing and does
 * not count toward clearing an open insight.
 */
export interface InsightRule<Input> {
	id: string;
	skip?(input: Input): boolean;
	evaluate(input: Input): DetectedInsight | null;
}
