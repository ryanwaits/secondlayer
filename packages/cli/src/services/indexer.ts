import { resolve, dirname } from "node:path";
import { serviceManager } from "./manager.ts";

const SERVICE_NAME = "indexer";

export async function startIndexer(options: {
  port?: number;
  onLog?: (line: string) => void;
}): Promise<void> {
  const port = options.port ?? 3700;
  const rootDir = dirname(dirname(dirname(dirname(import.meta.dir))));
  const indexerPath = resolve(rootDir, "packages/indexer/src/index.ts");

  await serviceManager.start(SERVICE_NAME, ["bun", "run", "--watch", indexerPath], {
    port,
    env: {
      PORT: String(port),
    },
    onStdout: options.onLog,
    onStderr: options.onLog,
  });
}

export async function stopIndexer(): Promise<void> {
  await serviceManager.stop(SERVICE_NAME);
}

export function isIndexerRunning(): boolean {
  return serviceManager.isRunning(SERVICE_NAME);
}

export function getIndexerPort(): number | null {
  return serviceManager.getPort(SERVICE_NAME);
}
