import { getErrorMessage } from "@secondlayer/shared";
import type { Database } from "@secondlayer/shared/db";
import { renderEmail, sendEmail } from "@secondlayer/shared/email";
import { logger } from "@secondlayer/shared/logger";
import { isPlatformMode } from "@secondlayer/shared/mode";
import type { Kysely } from "kysely";

/**
 * Email an account when their subgraph's reindex/backfill finishes — the
 * counterpart to the CLI/dashboard ETA (they still had to leave a terminal or
 * tab open to see either). Fire-and-forget: a failed send only logs a
 * warning, never fails or retries against the reindex itself.
 *
 * Platform mode only: accounts live there. An instance (including a hosted
 * tenant stack) stamps its subgraphs with no account, so the lookup below has
 * nothing to match and would only fail on an empty uuid.
 */
export async function notifyReindexComplete(
	db: Kysely<Database>,
	subgraphName: string,
	stats: { blocks: number; events: number; errors: number },
): Promise<void> {
	if (!isPlatformMode()) return;
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

		const errors = stats.errors.toLocaleString();
		const failed = stats.errors > 0;
		const subject = failed
			? `Reindex complete with ${errors} errors: ${subgraphName}`
			: `Reindex complete: ${subgraphName}`;

		const { html, text } = renderEmail({
			heading: failed
				? `${subgraphName} finished with ${errors} errors`
				: `${subgraphName} finished reindexing`,
			preheader: `${stats.blocks.toLocaleString()} blocks, ${stats.events.toLocaleString()} events, ${failed ? `${errors} handler errors` : "no errors"}.`,
			paragraphs: [
				failed
					? `${errors} events failed in your handlers. Everything else is indexed.`
					: "It's serving queries from the new data now.",
			],
			facts: [
				{ label: "Blocks", value: stats.blocks.toLocaleString() },
				{ label: "Events", value: stats.events.toLocaleString() },
				{ label: "Errors", value: errors },
			],
			figure: `subgraph · ${subgraphName}`,
			status: failed
				? { tone: "alarm", text: `Complete, ${errors} errors` }
				: { tone: "ok", text: "Complete, no errors" },
			cta: {
				label: failed ? "See the errors" : "Open the subgraph",
				url: `https://secondlayer.tools/account/subgraphs/${encodeURIComponent(subgraphName)}`,
			},
			footnote: "You get this because reindex emails are on for your account.",
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
