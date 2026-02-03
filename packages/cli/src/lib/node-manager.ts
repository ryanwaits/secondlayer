import { loadConfig } from "./config.ts";
import { getChainId } from "./network.ts";

export interface NodeConfig {
  installPath: string;
  network: "mainnet" | "testnet";
}

export async function getNodeConfig(): Promise<NodeConfig | null> {
  const config = await loadConfig();
  if (!config.node?.installPath || !config.node?.network) {
    return null;
  }
  return {
    installPath: config.node.installPath,
    network: config.node.network,
  };
}

export async function isDockerRunning(): Promise<boolean> {
  try {
    const result = await Bun.$`docker info`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function validateNodePath(path: string): Promise<{ valid: boolean; error?: string }> {
  const manageScript = Bun.file(`${path}/manage.sh`);
  const envFile = Bun.file(`${path}/.env`);

  if (!(await manageScript.exists())) {
    return { valid: false, error: "manage.sh not found" };
  }
  if (!(await envFile.exists())) {
    return { valid: false, error: ".env file not found" };
  }
  return { valid: true };
}

export async function runManageScript(
  installPath: string,
  network: string,
  action: string,
  extraArgs: string[] = []
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const args = ["bash", "./manage.sh", "-n", network, "-a", action, ...extraArgs];
  const proc = Bun.spawn(args, {
    cwd: installPath,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  return { stdout: "", stderr: "", exitCode };
}

/**
 * Start node containers using docker compose directly.
 * Bypasses manage.sh to avoid macOS sed compatibility issues.
 */
export async function startNodeContainers(installPath: string, network: string): Promise<boolean> {
  // Ensure persistent data dirs exist
  const dirs = [
    `${installPath}/persistent-data/${network}/stacks-blockchain`,
  ];
  for (const dir of dirs) {
    await Bun.$`mkdir -p ${dir}`.quiet().nothrow();
  }

  const chainId = getChainId(network as "mainnet" | "testnet");

  // Smart recreate: check if running container has mismatched chain ID
  try {
    const inspect = await Bun.$`docker inspect --format={{.Config.Env}} stacks-blockchain`.quiet().nothrow();
    if (inspect.exitCode === 0) {
      const envStr = inspect.stdout.toString();
      const match = envStr.match(/STACKS_CHAIN_ID=(\d+)/);
      if (match && match[1] !== chainId) {
        // Chain ID mismatch — tear down first
        await Bun.$`docker compose -f compose-files/common.yaml -f compose-files/networks/${network}.yaml --env-file .env down`
          .cwd(installPath)
          .env({ ...process.env, SCRIPTPATH: installPath, STACKS_CHAIN_ID: chainId })
          .quiet()
          .nothrow();
      }
    }
  } catch {
    // No existing container or docker issue — proceed normally
  }

  const result = await Bun.$`docker compose -f compose-files/common.yaml -f compose-files/networks/${network}.yaml --profile stacks-blockchain --env-file .env up -d`
    .cwd(installPath)
    .env({
      ...process.env,
      SCRIPTPATH: installPath,
      STACKS_CHAIN_ID: chainId,
    })
    .quiet()
    .nothrow();

  return result.exitCode === 0;
}

export async function getNodeContainers(): Promise<{ name: string; status: string }[]> {
  try {
    // Look for stacks-related containers by name
    const result = await Bun.$`docker ps --format json --filter "name=stacks"`.quiet();
    if (result.exitCode !== 0) return [];

    const lines = result.stdout.toString().trim().split("\n").filter(Boolean);
    const containers: { name: string; status: string }[] = [];

    for (const line of lines) {
      try {
        const container = JSON.parse(line);
        containers.push({
          name: container.Names || container.Name,
          status: container.Status || "unknown",
        });
      } catch {
        // Skip non-JSON lines
      }
    }
    return containers;
  } catch {
    return [];
  }
}

export async function isNodeRunning(): Promise<boolean> {
  const containers = await getNodeContainers();
  // Check if stacks-blockchain container is running (not restarting)
  return containers.some(
    (c) => c.name.includes("stacks-blockchain") && !c.status.includes("Restarting")
  );
}

// Patterns to filter out with --quiet
const QUIET_PATTERNS = [
  /Failed to validate Nakamoto block/,
  /NoSuchNeighbor/,
  /Database is locked/,
  /no reward set for cycle/,
  /Will NOT download/,
  /cannot be found in the staging DB/,
  /No such neighbor/,
  /Invalid block commit/,
];

export interface LogOptions {
  follow?: boolean;
  lines?: number;
  service?: string;
  quiet?: boolean;
  format?: boolean;
}

export async function getNodeLogs(
  options: LogOptions = {}
): Promise<AsyncGenerator<string, void, unknown>> {
  // docker logs only accepts one container - default to stacks-blockchain
  const container = options.service || "stacks-blockchain";

  const args: string[] = ["logs"];
  if (options.lines) args.push("--tail", options.lines.toString());
  if (options.follow) args.push("-f");
  args.push(container);

  const proc = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Docker logs go to stderr, merge both streams
  const merged = new ReadableStream({
    async start(controller) {
      const readStream = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } finally {
          reader.releaseLock();
        }
      };
      await Promise.all([
        readStream(proc.stdout as unknown as ReadableStream<Uint8Array>),
        readStream(proc.stderr as unknown as ReadableStream<Uint8Array>),
      ]);
      controller.close();
    },
  });

  async function* generate() {
    const reader = merged.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          // Skip empty lines
          if (!line.trim()) continue;

          // Apply quiet filter
          if (options.quiet && shouldFilterLine(line)) continue;

          // Format if requested
          const output = options.format ? formatLogLine(line) : line;
          if (output) yield output;
        }
      }
      if (buffer) {
        const output = options.format ? formatLogLine(buffer) : buffer;
        if (output) yield output;
      }
    } finally {
      reader.releaseLock();
      proc.kill();
    }
  }

  return generate();
}

function shouldFilterLine(line: string): boolean {
  return QUIET_PATTERNS.some((pattern) => pattern.test(line));
}

// Parse Stacks node log format: INFO [timestamp] [source] [thread] message
const LOG_REGEX = /^(INFO|WARN|ERROR|DEBUG)\s+\[(\d+\.\d+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/;

function formatLogLine(line: string): string | null {
  const match = line.match(LOG_REGEX);
  if (!match) {
    // Return as-is if doesn't match expected format
    return line;
  }

  const [, level, timestamp, _source, _thread, message] = match;

  // Convert unix timestamp to ISO
  const date = new Date(parseFloat(timestamp!) * 1000);
  const isoTime = date.toISOString();

  // Truncate message if too long, extract key info
  const shortMessage = extractKeyInfo(message!);

  return `[stacks-node] [${isoTime}] ${level}: ${shortMessage}`;
}

function extractKeyInfo(message: string): string {
  // Clean up common verbose messages
  if (message.includes("Advanced to new tip")) {
    const hashMatch = message.match(/([a-f0-9]{64})/);
    const hash = hashMatch ? hashMatch[1]!.slice(0, 16) + "..." : "";
    return `Advanced to new tip ${hash}`;
  }

  if (message.includes("Downloading")) {
    return message.replace(/local::[^\s]+/, "").trim();
  }

  // Truncate long messages
  if (message.length > 120) {
    return message.slice(0, 117) + "...";
  }

  return message;
}

const NODE_CONTAINERS = ["stacks-blockchain"];

/**
 * Stop node containers directly with docker stop, then remove them
 * and clean up the Docker network. Returns containers that were stopped.
 */
export async function stopNodeContainers(): Promise<string[]> {
  const stopped: string[] = [];

  for (const container of NODE_CONTAINERS) {
    try {
      const result = await Bun.$`docker stop ${container}`.quiet();
      if (result.exitCode === 0) {
        stopped.push(container);
      }
    } catch {
      // Container not running or doesn't exist
    }
  }

  // Remove stopped containers so they don't block next start
  for (const container of NODE_CONTAINERS) {
    await Bun.$`docker rm ${container}`.quiet().nothrow();
  }

  // Clean up the stacks network
  await Bun.$`docker network rm stacks`.quiet().nothrow();

  return stopped;
}
