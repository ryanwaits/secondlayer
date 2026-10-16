import { apiRequest, getSessionFromRequest } from "@/lib/api";
import { type Insight, rankInsights } from "@/lib/insights";
import { NextResponse } from "next/server";

/**
 * One list for the dashboard: the stack's insights (webhooks, subgraphs) and
 * the account's (reads, billing) merged and ranked. A side that fails
 * contributes nothing and is reported in `sources`, so one unreachable half
 * never blanks the other. Ids are prefixed `t:` (stack) or `a:` (account) so
 * the action route knows which API owns them.
 */

type Source = "ok" | "unavailable";

async function fetchSide(
	path: string,
	prefix: "t" | "a",
	sessionToken: string,
): Promise<{ data: Insight[]; source: Source }> {
	try {
		const res = await apiRequest<{ data: Insight[] }>(path, { sessionToken });
		const data = (res.data ?? []).map((insight) => ({
			...insight,
			id: `${prefix}:${insight.id}`,
		}));
		return { data, source: "ok" };
	} catch {
		// 404 on a self-host api without /api/accounts, 503 while a stack
		// starts, a network error: this side has nothing to say right now.
		return { data: [], source: "unavailable" };
	}
}

export async function GET(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}

	const resource = new URL(req.url).searchParams.get("resource");
	const stackPath = resource
		? `/api/insights?resource=${encodeURIComponent(resource)}`
		: "/api/insights";

	const [stack, account] = await Promise.all([
		fetchSide(stackPath, "t", sessionToken),
		fetchSide("/api/accounts/insights", "a", sessionToken),
	]);

	return NextResponse.json({
		data: rankInsights([...stack.data, ...account.data]),
		sources: { stack: stack.source, account: account.source },
	});
}
