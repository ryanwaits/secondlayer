// Worker service - evaluates filters and dispatches webhooks
import { logger, getEnv } from "@secondlayer/shared";
import { claim, complete, fail, getWorkerId } from "@secondlayer/shared/queue";
import { listenForJobs } from "@secondlayer/shared/queue/listener";
import { startRecoveryLoop } from "@secondlayer/shared/queue/recovery";
import { processJob } from "./processor.ts";
import { startStorageMeasurement } from "./jobs/measure-storage.ts";

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "5");
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "1000");

let activeJobs = 0;
let running = true;

/**
 * Process a single job from the queue
 */
async function processNextJob(): Promise<boolean> {
  if (activeJobs >= CONCURRENCY || !running) {
    return false;
  }

  const job = await claim();
  if (!job) {
    return false;
  }

  activeJobs++;
  logger.debug("Processing job", {
    jobId: job.id,
    streamId: job.stream_id,
    blockHeight: job.block_height,
  });

  try {
    await processJob(job);
    await complete(job.id);
    logger.debug("Job completed", { jobId: job.id });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Job failed", { jobId: job.id, error: errorMessage });
    await fail(job.id, errorMessage);
  } finally {
    activeJobs--;
  }

  return true;
}

/**
 * Main worker loop
 */
async function runWorker() {
  const workerId = getWorkerId();
  const env = getEnv();
  logger.info("Starting worker", {
    workerId,
    concurrency: CONCURRENCY,
    networks: env.enabledNetworks,
  });

  // Start stale job recovery loop
  const stopRecovery = startRecoveryLoop(60000, 5);

  // Start periodic storage measurement
  const stopStorageMeasurement = startStorageMeasurement();

  // Listen for new job notifications
  const stopListening = await listenForJobs(async () => {
    // Process jobs when notified
    while (await processNextJob()) {
      // Keep processing until no more jobs or at capacity
    }
  });

  // Poll for jobs periodically (backup for missed notifications)
  const pollInterval = setInterval(async () => {
    if (!running) return;
    while (await processNextJob()) {
      // Keep processing until no more jobs or at capacity
    }
  }, POLL_INTERVAL_MS);

  // Initial job processing
  while (await processNextJob()) {
    // Process any pending jobs on startup
  }

  logger.info("Worker ready", { workerId });

  // Handle shutdown
  const shutdown = async () => {
    if (!running) return;
    running = false;

    logger.info("Shutting down worker...");

    clearInterval(pollInterval);
    await stopListening();
    stopRecovery();
    stopStorageMeasurement();

    // Wait for active jobs to complete
    while (activeJobs > 0) {
      logger.info("Waiting for active jobs", { activeJobs });
      await new Promise((r) => setTimeout(r, 1000));
    }

    logger.info("Worker shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Start the worker
runWorker().catch((error) => {
  logger.error("Worker failed to start", { error });
  process.exit(1);
});
