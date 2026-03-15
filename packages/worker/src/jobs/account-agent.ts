import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { getErrorMessage } from "@secondlayer/shared";
import { runAccountAgent } from "@secondlayer/account-agent";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Start periodic account agent runs. Returns a cleanup function.
 */
export function startAccountAgentScheduler(): () => void {
  const run = async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return; // Skip if no API key configured
    }

    try {
      const db = getDb();

      // Get paid accounts (skip free tier)
      const accounts = await db
        .selectFrom("accounts")
        .select("id")
        .where("plan", "!=", "free")
        .execute();

      for (const account of accounts) {
        try {
          const result = await runAccountAgent(account.id, db);
          if (result.insights_created > 0) {
            logger.info("Account agent completed", {
              accountId: account.id,
              insights: result.insights_created,
              cost: result.cost_usd,
            });
          }
        } catch (err) {
          logger.error("Account agent failed", {
            accountId: account.id,
            error: getErrorMessage(err),
          });
        }
      }
    } catch (err) {
      logger.error("Account agent scheduler failed", {
        error: getErrorMessage(err),
      });
    }
  };

  // Delay first run by 60s to let services settle
  const initialTimeout = setTimeout(run, 60_000);
  const interval = setInterval(run, INTERVAL_MS);

  return () => {
    clearTimeout(initialTimeout);
    clearInterval(interval);
  };
}
