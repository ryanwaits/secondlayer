import { resolve, dirname } from "node:path";
import { serviceManager } from "./manager.ts";

const SERVICE_NAME = "worker";

export async function startWorker(options: {
  concurrency?: number;
  onLog?: (line: string) => void;
}): Promise<void> {
  const rootDir = dirname(dirname(dirname(dirname(import.meta.dir))));
  const workerPath = resolve(rootDir, "packages/worker/src/index.ts");

  await serviceManager.start(SERVICE_NAME, ["bun", "run", "--watch", workerPath], {
    env: {
      WORKER_CONCURRENCY: String(options.concurrency ?? 5),
    },
    onStdout: options.onLog,
    onStderr: options.onLog,
  });
}

export async function stopWorker(): Promise<void> {
  await serviceManager.stop(SERVICE_NAME);
}

export function isWorkerRunning(): boolean {
  return serviceManager.isRunning(SERVICE_NAME);
}
