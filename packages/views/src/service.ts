// View processor service entry point
// Run with: bun run packages/views/src/service.ts
import { logger } from "@secondlayer/shared/logger";
import { startViewProcessor } from "./runtime/processor.ts";

const processor = await startViewProcessor({
  concurrency: parseInt(process.env.VIEW_CONCURRENCY ?? "5"),
});

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down view processor...");
  await processor();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
