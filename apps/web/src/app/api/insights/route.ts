import { getSessionFromRequest } from "@/lib/api";
import { rankInsights } from "@/lib/insights";
import { fetchInsightSide } from "@/lib/server/insights-read";
import { NextResponse } from "next/server";

// Next to the API, so each dashboard read and write takes the short hop.
export const preferredRegion = "fra1";

/** One list for the dashboard: see `readInsights`. */

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
		timed(() => fetchInsightSide(stackPath, "t", sessionToken)),
		timed(() => fetchInsightSide("/api/accounts/insights", "a", sessionToken)),
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
