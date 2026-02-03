import { resolve, dirname } from "node:path";
import { serviceManager } from "./manager.ts";

const SERVICE_NAME = "api";

export async function startApi(options: {
  port?: number;
  onLog?: (line: string) => void;
}): Promise<void> {
  const port = options.port ?? 3800;
  const rootDir = dirname(dirname(dirname(dirname(import.meta.dir))));
  const apiPath = resolve(rootDir, "packages/api/src/index.ts");

  await serviceManager.start(SERVICE_NAME, ["bun", "run", "--watch", apiPath], {
    port,
    env: {
      PORT: String(port),
    },
    onStdout: options.onLog,
    onStderr: options.onLog,
  });
}

export async function stopApi(): Promise<void> {
  await serviceManager.stop(SERVICE_NAME);
}

export function isApiRunning(): boolean {
  return serviceManager.isRunning(SERVICE_NAME);
}

export function getApiPort(): number | null {
  return serviceManager.getPort(SERVICE_NAME);
}
