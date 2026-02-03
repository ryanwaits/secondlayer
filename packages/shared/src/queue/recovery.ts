import { sql } from "kysely";
import { getDb } from "../db/index.ts";

/**
 * Recover jobs that have been locked for longer than the threshold
 * These are likely from crashed workers
 *
 * @param staleThresholdMinutes - Minutes after which a locked job is considered stale
 * @returns Number of recovered jobs
 */
export async function recoverStaleJobs(
  staleThresholdMinutes = 5
): Promise<number> {
  const { rows } = await sql`
    UPDATE jobs
    SET
      status = 'pending',
      locked_at = NULL,
      locked_by = NULL
    WHERE
      status = 'processing'
      AND locked_at < NOW() - INTERVAL '${sql.raw(staleThresholdMinutes.toString())} minutes'
    RETURNING id
  `.execute(getDb());

  return rows.length;
}

/**
 * Run periodic stale job recovery
 * Returns a cleanup function to stop the interval
 */
export function startRecoveryLoop(
  intervalMs = 60000, // 1 minute
  staleThresholdMinutes = 5
): () => void {
  const intervalId = setInterval(async () => {
    try {
      const recovered = await recoverStaleJobs(staleThresholdMinutes);
      if (recovered > 0) {
        console.log(`Recovered ${recovered} stale jobs`);
      }
    } catch (error) {
      console.error("Error recovering stale jobs:", error);
    }
  }, intervalMs);

  return () => clearInterval(intervalId);
}
