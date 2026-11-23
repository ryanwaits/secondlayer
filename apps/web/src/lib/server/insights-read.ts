// Server-only: never import from client code.
import { apiRequest } from "@/lib/api";
import { type Insight, rankInsights } from "@/lib/insights";
import { UPSTREAM_READ_TIMEOUT_MS, logIfTimeout } from "@/lib/upstream-timeout";

/**
 * A side that fails contributes nothing and is reported in `source`, so one
 * unreachable half never blanks the other. Ids are prefixed `t:` (stack) or
 * `a:` (account) so the action route knows which API owns them.
 */

export type InsightSource = "ok" | "unavailable";

export async function fetchInsightSide(
	path: string,
	prefix: "t" | "a",
	sessionToken: string,
	timeoutMs?: number,
): Promise<{ data: Insight[]; source: InsightSource }> {
	try {
		const res = await apiRequest<{ data: Insight[] }>(path, {
			sessionToken,
			timeoutMs,
		});
		const data = (res.data ?? []).map((insight) => ({
			...insight,
			id: `${prefix}:${insight.id}`,
		}));
		return { data, source: "ok" };
	} catch (err) {
		logIfTimeout(err, path);
		// 404 on a self-host api without /api/accounts, 503 while a stack
		// starts, a network error: this side has nothing to say right now.
		return { data: [], source: "unavailable" };
	}
}

export async function readInsights(
	sessionToken: string,
): Promise<Insight[] | null> {
	const [stack, account] = await Promise.all([
		fetchInsightSide(
			"/api/insights",
			"t",
			sessionToken,
			UPSTREAM_READ_TIMEOUT_MS,
		),
		fetchInsightSide(
			"/api/accounts/insights",
			"a",
			sessionToken,
			UPSTREAM_READ_TIMEOUT_MS,
		),
	]);
	if (stack.source === "unavailable" && account.source === "unavailable") {
		return null;
	}
	return rankInsights([...stack.data, ...account.data]);
}
