import { getErrorMessage } from "@secondlayer/shared";
import type { Database } from "@secondlayer/shared/db";
import { renderEmail, sendEmail } from "@secondlayer/shared/email";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";

/**
 * Email an account when their subgraph's reindex/backfill finishes — the
 * counterpart to the CLI/dashboard ETA (they still had to leave a terminal or
 * tab open to see either). Fire-and-forget: a failed send only logs a
 * warning, never fails or retries against the reindex itself.
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

		const subject = `Reindex complete: ${subgraphName}`;
		const errorsLabel =
			stats.errors > 0
				? `${stats.errors.toLocaleString()} errors`
				: "no errors";
		const paragraph = `Your subgraph "${subgraphName}" finished reindexing: ${stats.blocks.toLocaleString()} blocks, ${stats.events.toLocaleString()} events, ${errorsLabel}.`;

		const { html, text } = renderEmail({
			heading: subject,
			paragraphs: [paragraph],
		});

		await sendEmail({ to: account.email, subject, html, text });
	} catch (err) {
		// Never let a notification failure affect the reindex result.
		logger.warn("reindex-complete email threw", {
			subgraph: subgraphName,
			error: getErrorMessage(err),
		});
	}
}
