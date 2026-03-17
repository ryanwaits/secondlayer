import { resolve, dirname } from "node:path";
import { serviceManager } from "./manager.ts";

const SERVICE_NAME = "subgraph-processor";

export async function startSubgraphProcessor(options: {
  concurrency?: number;
  onLog?: (line: string) => void;
}): Promise<void> {
  const rootDir = dirname(dirname(dirname(dirname(import.meta.dir))));
  const servicePath = resolve(rootDir, "packages/subgraphs/src/service.ts");

  await serviceManager.start(SERVICE_NAME, ["bun", "run", "--watch", servicePath], {
    env: {
      SUBGRAPH_CONCURRENCY: String(options.concurrency ?? 5),
    },
    onStdout: options.onLog,
    onStderr: options.onLog,
  });
}

export async function stopSubgraphProcessor(): Promise<void> {
  await serviceManager.stop(SERVICE_NAME);
}

export function isSubgraphProcessorRunning(): boolean {
  return serviceManager.isRunning(SERVICE_NAME);
}
