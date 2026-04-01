// Subgraph processor service entry point
// Run with: bun run packages/subgraphs/src/service.ts
import { logger } from "@secondlayer/shared/logger";
import { startSubgraphProcessor } from "./runtime/processor.ts";

const processor = await startSubgraphProcessor({
	concurrency: Number.parseInt(process.env.SUBGRAPH_CONCURRENCY ?? "5"),
});

// Graceful shutdown
const shutdown = async () => {
	logger.info("Shutting down subgraph processor...");
	await processor();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
