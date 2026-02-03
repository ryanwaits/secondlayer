import { resolve, dirname } from "node:path";
import { serviceManager } from "./manager.ts";

const SERVICE_NAME = "view-processor";

export async function startViewProcessor(options: {
  concurrency?: number;
  onLog?: (line: string) => void;
}): Promise<void> {
  const rootDir = dirname(dirname(dirname(dirname(import.meta.dir))));
  const servicePath = resolve(rootDir, "packages/views/src/service.ts");

  await serviceManager.start(SERVICE_NAME, ["bun", "run", "--watch", servicePath], {
    env: {
      VIEW_CONCURRENCY: String(options.concurrency ?? 5),
    },
    onStdout: options.onLog,
    onStderr: options.onLog,
  });
}

export async function stopViewProcessor(): Promise<void> {
  await serviceManager.stop(SERVICE_NAME);
}

export function isViewProcessorRunning(): boolean {
  return serviceManager.isRunning(SERVICE_NAME);
}
