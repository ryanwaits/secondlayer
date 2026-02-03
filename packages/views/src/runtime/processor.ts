import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { listen } from "@secondlayer/shared/queue/listener";
import { listViews, updateViewStatus } from "@secondlayer/shared/db/queries/views";
import type { View } from "@secondlayer/shared/db";
import type { ViewDefinition } from "../types.ts";
import { catchUpView } from "./catchup.ts";
import { handleViewReorg } from "./reorg.ts";

const CHANNEL_NEW_BLOCK = "streams:new_job";
const DEFAULT_CONCURRENCY = 5;
const POLL_INTERVAL_MS = 5_000;

/**
 * Load a ViewDefinition from its handler file path.
 */
async function loadViewDefinition(handlerPath: string): Promise<ViewDefinition> {
  const mod = await import(handlerPath);
  return mod.default ?? mod;
}

/**
 * Start the view processor service.
 * Listens for new blocks via NOTIFY and processes them through all active views.
 */
export async function startViewProcessor(opts?: {
  concurrency?: number;
}): Promise<() => Promise<void>> {
  const concurrency = opts?.concurrency ?? DEFAULT_CONCURRENCY;
  let running = true;

  logger.info("Starting view processor", { concurrency });

  // Catch-up all views on startup
  const db = getDb();
  const activeViews = (await listViews(db)).filter((v: View) => v.status === "active");
  for (const view of activeViews) {
    try {
      const def = await loadViewDefinition(view.handler_path);
      await catchUpView(def, view.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Cannot find module") || msg.includes("ENOENT")) {
        await updateViewStatus(db, view.name, "error");
      }
      logger.error("View catch-up failed on startup", {
        view: view.name,
        error: msg,
      });
    }
  }

  // Listen for new blocks
  const stopListening = await listen(CHANNEL_NEW_BLOCK, async () => {
    if (!running) return;
    // The NOTIFY payload doesn't include block height — we rely on
    // each view's last_processed_block to determine what to process.
    // Trigger catch-up for all views.
    const db = getDb();
    const views = (await listViews(db)).filter((v: View) => v.status === "active");
    for (const view of views) {
      try {
        const def = await loadViewDefinition(view.handler_path);
        await catchUpView(def, view.name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Cannot find module") || msg.includes("ENOENT")) {
          await updateViewStatus(db, view.name, "error");
        }
        logger.error("View processing failed", {
          view: view.name,
          error: msg,
        });
      }
    }
  });

  // Listen for reorgs
  const stopReorgListening = await listen("view_reorg", async (payload) => {
    if (!running) return;
    try {
      const data = JSON.parse(payload ?? "{}");
      const blockHeight = data.blockHeight;
      if (typeof blockHeight === "number") {
        await handleViewReorg(blockHeight, loadViewDefinition);
      }
    } catch (err) {
      logger.error("View reorg handling failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Poll as backup
  const pollInterval = setInterval(async () => {
    if (!running) return;
    const db = getDb();
    const views = (await listViews(db)).filter((v: View) => v.status === "active");
    for (const view of views) {
      try {
        const def = await loadViewDefinition(view.handler_path);
        await catchUpView(def, view.name);
      } catch (err) {
        logger.error("View poll processing failed", {
          view: view.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, POLL_INTERVAL_MS);

  logger.info("View processor ready");

  // Return shutdown function
  return async () => {
    running = false;
    clearInterval(pollInterval);
    await stopListening();
    await stopReorgListening();
    logger.info("View processor stopped");
  };
}
