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

const ms = (n: number) => n.toFixed(1);

/** Times one half so Server-Timing shows which side paid for a cold connection. */
async function timed<T>(run: () => Promise<T>): Promise<[T, number]> {
	const start = performance.now();
	const result = await run();
	return [result, performance.now() - start];
}

export async function GET(req: Request) {
	const started = performance.now();
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json(
			{ error: "Sign in first" },
			{
				status: 401,
				headers: {
					"Server-Timing": `total;dur=${ms(performance.now() - started)}`,
				},
			},
		);
	}

	const resource = new URL(req.url).searchParams.get("resource");
	const stackPath = resource
		? `/api/insights?resource=${encodeURIComponent(resource)}`
		: "/api/insights";

	const [[stack, stackMs], [account, accountMs]] = await Promise.all([
		timed(() => fetchSide(stackPath, "t", sessionToken)),
		timed(() => fetchSide("/api/accounts/insights", "a", sessionToken)),
	]);

	return NextResponse.json(
		{
			data: rankInsights([...stack.data, ...account.data]),
			sources: { stack: stack.source, account: account.source },
		},
		{
			headers: {
				"Server-Timing": `stack;dur=${ms(stackMs)}, account;dur=${ms(accountMs)}, total;dur=${ms(performance.now() - started)}`,
			},
		},
	);
}
