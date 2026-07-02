import { getErrorMessage } from "@secondlayer/shared";
import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";

/**
 * Email an account when their subgraph's reindex/backfill finishes — the
 * counterpart to the CLI/dashboard ETA (they still had to leave a terminal or
 * tab open to see either). Fire-and-forget: a failed send only logs a
 * warning, never fails or retries against the reindex itself.
 *
 * Mirrors the Resend pattern in
 * `packages/worker/src/jobs/spend-cap-alert.ts` (`sendCapAlert`) — same env
 * vars, same "log and skip" behavior when unconfigured.
 */
export async function notifyReindexComplete(
	db: Kysely<Database>,
	subgraphName: string,
	stats: { blocks: number; events: number; errors: number },
): Promise<void> {
	try {
		const subgraph = await db
			.selectFrom("subgraphs")
			.select(["account_id"])
			.where("name", "=", subgraphName)
			.executeTakeFirst();
		if (!subgraph) return;

		const account = await db
			.selectFrom("accounts")
			.select(["email", "notify_reindex_complete"])
			.where("id", "=", subgraph.account_id)
			.executeTakeFirst();
		if (!account?.email || !account.notify_reindex_complete) return;

		const resendKey = process.env.RESEND_API_KEY;
		if (!resendKey) {
			logger.warn("RESEND_API_KEY unset — skipping reindex-complete email", {
				subgraph: subgraphName,
			});
			return;
		}

		const from =
			process.env.EMAIL_FROM ?? "Secondlayer <noreply@secondlayer.tools>";
		const body =
			stats.errors > 0
				? `Your subgraph "${subgraphName}" finished reindexing — ${stats.blocks.toLocaleString()} blocks, ${stats.events.toLocaleString()} events, ${stats.errors.toLocaleString()} errors. Check the dashboard for details.`
				: `Your subgraph "${subgraphName}" finished reindexing — ${stats.blocks.toLocaleString()} blocks, ${stats.events.toLocaleString()} events processed, no errors. It's live now.`;

		const res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${resendKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from,
				to: [account.email],
				subject: `Reindex complete: ${subgraphName}`,
				text: body,
			}),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			logger.warn("reindex-complete email failed", {
				subgraph: subgraphName,
				status: res.status,
				body: text.slice(0, 200),
			});
		}
	} catch (err) {
		// Never let a notification failure affect the reindex result.
		logger.warn("reindex-complete email threw", {
			subgraph: subgraphName,
			error: getErrorMessage(err),
		});
	}
}
