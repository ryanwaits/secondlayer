/**
 * Dev service implementation - extracted from dev.ts for use by local.ts
 */
import { resolve, dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  serviceManager,
  startIndexer,
  startWorker,
  startApi,
  startWebhookServer,
  stopWebhookServer,
  startViewProcessor,
} from "../services/index.ts";
import { success, error, info, dim, green, blue, yellow, red, cyan, magenta } from "../lib/output.ts";
import {
  loadDevState,
  saveDevState,
  clearDevState,
  clearLogs,
  getLogFile,
  getLogsDir,
  ensureDirs,
  isProcessRunning,
  getRunningServices,
  isDevRunning,
  type DevState,
  type ServiceState,
} from "../lib/dev-state.ts";
import { loadConfig, getDataDir, configExists, saveConfig, getDefaultConfig, getConfigPath } from "../lib/config.ts";
import { requireDocker, DockerNotAvailableError } from "../lib/docker.ts";
import { validateNetworkConsistency } from "../lib/network.ts";

const DEV_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/streams_dev";

export interface DevOptions {
  indexerPort: string;
  apiPort: string;
  webhookPort: string;
  webhook: boolean;
  worker: boolean;
  secret?: string;
  stacksNode?: boolean;
  foreground?: boolean;
}

export async function isDevAlreadyRunning(): Promise<boolean> {
  if (await isDevRunning()) {
    const running = await getRunningServices();
    info("Dev environment already running");
    console.log("");
    printRunningServices(running);
    console.log("");
    console.log(dim("Commands:"));
    console.log(`  ${green("sl local logs")}     ${dim("View logs")}`);
    console.log(`  ${green("sl local stop")}     ${dim("Stop all services")}`);
    console.log(`  ${green("sl local status")}   ${dim("Show status")}`);
    console.log(`  ${green("sl streams set --all paused --wait")} ${dim("Pause stream processing")}`);
    return true;
  }
  return false;
}

export async function runBackground(options: DevOptions): Promise<void> {
  // Auto-init config if it doesn't exist
  if (!(await configExists())) {
    const defaultConfig = getDefaultConfig();
    await saveConfig(defaultConfig);
    info(`Created default config at ${getConfigPath()}`);
    console.log("");
  }

  // Load config for ports and data directory
  const config = await loadConfig();
  const dataDir = getDataDir(config);

  // Use config ports as defaults, CLI options override
  const indexerPort = options.stacksNode ? 3701 : parseInt(options.indexerPort) || config.ports.indexer;
  const apiPort = parseInt(options.apiPort) || config.ports.api;
  const webhookPort = parseInt(options.webhookPort) || config.ports.webhook;

  // Validate network consistency when connecting to a stacks node
  if (options.stacksNode && config.node) {
    const validation = await validateNetworkConsistency(config);
    if (!validation.valid) {
      error("Network mismatch detected:");
      for (const issue of validation.issues) {
        console.log(`  - ${issue}`);
      }
      process.exit(1);
    }
  }

  await ensureDirs();
  await clearLogs();

  printBanner();

  // Check Docker availability
  try {
    await requireDocker();
  } catch (err) {
    if (err instanceof DockerNotAvailableError) {
      error(err.message);
      process.exit(1);
    }
    throw err;
  }

  // Ensure dependencies
  let databaseUrl = process.env.DATABASE_URL;
  let startedPostgres = false;

  // Use external database if configured
  if (config.database.type === "external" && config.database.url) {
    databaseUrl = config.database.url;
  }

  if (databaseUrl) {
    // Verify the configured database is reachable
    const reachable = await isDatabaseReachable(databaseUrl);
    if (!reachable) {
      info(`Configured DATABASE_URL not reachable, starting PostgreSQL container...`);
      databaseUrl = undefined;
    }
  }

  if (!databaseUrl) {
    info("Starting PostgreSQL container...");
    startedPostgres = await ensureDevPostgres(dataDir);
    databaseUrl = DEV_DATABASE_URL;
    console.log(green("  ✓ PostgreSQL"), dim(`localhost:5432 (data: ${dataDir}/postgres)`));

    info("Running migrations...");
    await runMigrations(databaseUrl);
    console.log(green("  ✓ Migrations"), dim("complete"));
    console.log("");
  }

  const state: DevState = {
    services: {},
    dockerContainers: { postgres: startedPostgres },
    env: { DATABASE_URL: databaseUrl },
    startedAt: new Date().toISOString(),
  };

  try {
    // Start services in background with logs to files
    const packagesDir = dirname(dirname(dirname(dirname(import.meta.dir))));
    const env = { DATABASE_URL: databaseUrl, DEV_MODE: "true" };

    // API
    const apiLogFile = getLogFile("api");
    const apiProc = Bun.spawn(["bun", "run", resolve(packagesDir, "packages/api/src/index.ts")], {
      env: { ...process.env, ...env, PORT: String(apiPort) },
      stdout: Bun.file(apiLogFile),
      stderr: Bun.file(apiLogFile),
    });
    state.services.api = {
      pid: apiProc.pid,
      port: apiPort,
      startedAt: new Date().toISOString(),
      logFile: apiLogFile,
    };
    console.log(green("  ✓ API"), dim(`http://localhost:${apiPort}`));

    // Indexer
    const indexerLogFile = getLogFile("indexer");
    const indexerProc = Bun.spawn(["bun", "run", resolve(packagesDir, "packages/indexer/src/index.ts")], {
      env: { ...process.env, ...env, PORT: String(indexerPort) },
      stdout: Bun.file(indexerLogFile),
      stderr: Bun.file(indexerLogFile),
    });
    state.services.indexer = {
      pid: indexerProc.pid,
      port: indexerPort,
      startedAt: new Date().toISOString(),
      logFile: indexerLogFile,
    };
    console.log(green("  ✓ Indexer"), dim(`http://localhost:${indexerPort}`));

    // Worker
    if (options.worker) {
      const workerLogFile = getLogFile("worker");
      const workerProc = Bun.spawn(["bun", "run", resolve(packagesDir, "packages/worker/src/index.ts")], {
        env: { ...process.env, ...env },
        stdout: Bun.file(workerLogFile),
        stderr: Bun.file(workerLogFile),
      });
      state.services.worker = {
        pid: workerProc.pid,
        port: null,
        startedAt: new Date().toISOString(),
        logFile: workerLogFile,
      };
      console.log(green("  ✓ Worker"), dim("processing jobs"));
    }

    // View processor
    {
      const viewsLogFile = getLogFile("views");
      const viewsProc = Bun.spawn(["bun", "run", resolve(packagesDir, "packages/views/src/service.ts")], {
        env: { ...process.env, ...env },
        stdout: Bun.file(viewsLogFile),
        stderr: Bun.file(viewsLogFile),
      });
      state.services.views = {
        pid: viewsProc.pid,
        port: null,
        startedAt: new Date().toISOString(),
        logFile: viewsLogFile,
      };
      console.log(green("  ✓ View processor"), dim("processing views"));
    }

    // Webhook server
    if (options.webhook) {
      const webhookLogFile = getLogFile("webhook");
      const webhookArgs = ["bun", "run", resolve(packagesDir, "packages/cli/src/services/webhook-standalone.ts")];
      const webhookEnv: Record<string, string> = { ...process.env as Record<string, string>, PORT: String(webhookPort) };
      if (options.secret) webhookEnv.WEBHOOK_SECRET = options.secret;

      const webhookProc = Bun.spawn(webhookArgs, {
        env: webhookEnv,
        stdout: Bun.file(webhookLogFile),
        stderr: Bun.file(webhookLogFile),
      });
      state.services.webhook = {
        pid: webhookProc.pid,
        port: webhookPort,
        startedAt: new Date().toISOString(),
        logFile: webhookLogFile,
      };
      console.log(green("  ✓ Webhook server"), dim(`http://localhost:${webhookPort}`));
    }

    // Wait a bit for processes to start
    await Bun.sleep(500);

    // Verify processes are running
    for (const [name, service] of Object.entries(state.services)) {
      if (!isProcessRunning(service.pid)) {
        throw new Error(`${name} failed to start`);
      }
    }

    await saveDevState(state);

    console.log("");
    printUrls(indexerPort, apiPort, webhookPort, options.webhook);
    console.log("");
    success("Dev environment started in background");
    console.log("");
    console.log(dim("Commands:"));
    console.log(`  ${green("sl local logs -f")}   ${dim("Follow logs")}`);
    console.log(`  ${green("sl local stop")}      ${dim("Stop all services")}`);
    console.log(`  ${green("sl local status")}    ${dim("Show status")}`);
    console.log(`  ${green("sl streams set --all paused --wait")}  ${dim("Pause stream processing")}`);
    console.log("");

    // Exit explicitly - spawned processes keep event loop alive
    process.exit(0);
  } catch (err) {
    // Cleanup on error - kill started processes
    error("Startup failed, cleaning up...");

    // First try SIGTERM
    for (const service of Object.values(state.services)) {
      try {
        process.kill(service.pid, "SIGTERM");
      } catch {}
    }

    // Wait briefly for graceful shutdown
    await Bun.sleep(500);

    // Force kill any remaining processes by port
    const ports = Object.values(state.services)
      .map(s => s.port)
      .filter((p): p is number => p !== null);

    for (const port of ports) {
      await Bun.$`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`.quiet().nothrow();
    }

    await clearDevState();
    throw err;
  }
}

export async function runForeground(options: DevOptions): Promise<void> {
  // Auto-init config if it doesn't exist
  if (!(await configExists())) {
    const defaultConfig = getDefaultConfig();
    await saveConfig(defaultConfig);
    info(`Created default config at ${getConfigPath()}`);
    console.log("");
  }

  // Load config for ports and data directory
  const config = await loadConfig();
  const dataDir = getDataDir(config);

  // Use config ports as defaults, CLI options override
  const indexerPort = options.stacksNode ? 3701 : parseInt(options.indexerPort) || config.ports.indexer;
  const apiPort = parseInt(options.apiPort) || config.ports.api;
  const webhookPort = parseInt(options.webhookPort) || config.ports.webhook;

  let devPostgresStarted = false;

  const shutdown = async () => {
    console.log("\n");
    info("Shutting down services...");

    if (options.webhook) {
      stopWebhookServer();
    }

    await serviceManager.stopAll();

    if (devPostgresStarted) {
      info("Stopping PostgreSQL container...");
      await Bun.$`docker stop streams-dev-postgres`.quiet().nothrow();
      await Bun.$`docker rm streams-dev-postgres`.quiet().nothrow();
    }

    success("All services stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    printBanner();

    // Check Docker availability
    try {
      await requireDocker();
    } catch (err) {
      if (err instanceof DockerNotAvailableError) {
        error(err.message);
        process.exit(1);
      }
      throw err;
    }

    let databaseUrl = process.env.DATABASE_URL;

    // Use external database if configured
    if (config.database.type === "external" && config.database.url) {
      databaseUrl = config.database.url;
    }

    if (databaseUrl) {
      const reachable = await isDatabaseReachable(databaseUrl);
      if (!reachable) {
        info(`Configured DATABASE_URL not reachable, starting PostgreSQL container...`);
        databaseUrl = undefined;
      }
    }

    if (!databaseUrl) {
      info("Starting PostgreSQL container...");
      devPostgresStarted = await ensureDevPostgres(dataDir);
      databaseUrl = DEV_DATABASE_URL;
      process.env.DATABASE_URL = databaseUrl;
      console.log(green("  ✓ PostgreSQL"), dim(`localhost:5432 (data: ${dataDir}/postgres)`));

      info("Running migrations...");
      await runMigrations(databaseUrl);
      console.log(green("  ✓ Migrations"), dim("complete"));
      console.log("");
    }

    // Set DEV_MODE for all in-process services
    process.env.DEV_MODE = "true";

    if (options.webhook) {
      startWebhookServer({ port: webhookPort, secret: options.secret });
      console.log(green("  ✓ Webhook server"), dim(`http://localhost:${webhookPort}`));
    }

    await startApi({ port: apiPort, onLog: (line) => logService("api", line) });
    console.log(green("  ✓ API"), dim(`http://localhost:${apiPort}`));

    await startIndexer({ port: indexerPort, onLog: (line) => logService("indexer", line) });
    console.log(green("  ✓ Indexer"), dim(`http://localhost:${indexerPort}`));

    if (options.worker) {
      await startWorker({ onLog: (line) => logService("worker", line) });
      console.log(green("  ✓ Worker"), dim("processing jobs"));
    }

    await startViewProcessor({ onLog: (line) => logService("views", line) });
    console.log(green("  ✓ View processor"), dim("processing views"));

    console.log("");
    printUrls(indexerPort, apiPort, webhookPort, options.webhook);
    console.log("");
    info("Press Ctrl+C to stop all services");
    console.log("");

    await new Promise(() => {});
  } catch (err) {
    error(`Failed to start services: ${err}`);
    await serviceManager.stopAll();
    if (options.webhook) {
      stopWebhookServer();
    }
    process.exit(1);
  }
}

export async function showLogs(options: { follow?: boolean; service?: string; lines: string; verbose?: boolean }): Promise<void> {
  const state = await loadDevState();
  if (!state || Object.keys(state.services).length === 0) {
    error("Dev environment is not running");
    console.log(dim("Start with: sl local start"));
    process.exit(1);
  }

  const services = options.service
    ? { [options.service]: state.services[options.service] }
    : state.services;

  if (options.service && !state.services[options.service]) {
    error(`Unknown service: ${options.service}`);
    console.log(dim(`Available: ${Object.keys(state.services).join(", ")}`));
    process.exit(1);
  }

  const serviceEntries = Object.entries(services).filter(([, s]) => s) as [string, ServiceState][];

  if (serviceEntries.length === 0) {
    info("No log files found");
    return;
  }

  const lines = parseInt(options.lines);
  const verbose = options.verbose ?? false;

  if (options.follow) {
    await followLogs(serviceEntries, lines, verbose);
  } else {
    await showStaticLogs(serviceEntries, lines, verbose);
  }
}

const serviceColors: Record<string, (text: string) => string> = {
  api: blue,
  indexer: cyan,
  worker: yellow,
  views: magenta,
  webhook: green,
};

function formatWebhookSummary(jsonStr: string): string | null {
  try {
    const data = JSON.parse(jsonStr);
    if (data.type !== "webhook" || !data.body) return null;

    const { body, method, path, timestamp } = data;
    const streamName = body.streamName ?? body.streamId?.slice(0, 8) ?? "unknown";
    const height = body.block?.height ?? "?";
    const txCount = body.matches?.transactions?.length ?? 0;
    const eventCount = body.matches?.events?.length ?? 0;

    const dimTimestamp = dim(`[${timestamp}]`);
    return `${dimTimestamp} ${green("INFO:")} ${method} ${path} — ${streamName} block:${height} (${txCount} txs, ${eventCount} events)`;
  } catch {
    return null;
  }
}

function formatLogLine(service: string, line: string, verbose: boolean): string {
  const colorFn = serviceColors[service] ?? dim;
  const prefix = colorFn(`[${service}]`);

  // Parse log line: [timestamp] LEVEL: message
  const match = line.match(/^(\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\])\s*(INFO|WARN|ERROR|DEBUG):?\s*(.*)$/);

  if (match) {
    const [, timestamp, level, message] = match;
    const dimTimestamp = dim(timestamp!);

    if (level === "ERROR") {
      return `${prefix} ${dimTimestamp} ${red(level + ":")} ${message}`;
    } else if (level === "WARN") {
      return `${prefix} ${dimTimestamp} ${yellow(level + ":")} ${message}`;
    } else if (level === "INFO") {
      return `${prefix} ${dimTimestamp} ${green(level + ":")} ${message}`;
    } else if (level === "DEBUG") {
      return `${prefix} ${dimTimestamp} ${dim(level + ":")} ${dim(message!)}`;
    }
  }

  // Webhook payload: summarize unless verbose
  if (service === "webhook" && !verbose) {
    const summary = formatWebhookSummary(line);
    if (summary) return `${prefix} ${summary}`;
  }

  // Fallback for unstructured lines
  return `${prefix} ${line}`;
}

async function showStaticLogs(
  services: [string, ServiceState][],
  lines: number,
  verbose: boolean
): Promise<void> {
  // Collect all lines with service prefix
  const allLines: { service: string; line: string; timestamp: Date }[] = [];

  for (const [name, service] of services) {
    try {
      const content = await Bun.file(service.logFile).text();
      const fileLines = content.trim().split("\n").slice(-lines);

      for (const line of fileLines) {
        // Try to extract timestamp from log line
        const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/);
        const timestamp = tsMatch ? new Date(tsMatch[1]!) : new Date(0);
        allLines.push({ service: name, line, timestamp });
      }
    } catch {
      // File doesn't exist or can't be read
    }
  }

  // Sort by timestamp and print
  allLines.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  for (const { service, line } of allLines.slice(-lines)) {
    console.log(formatLogLine(service, line, verbose));
  }
}

async function followLogs(
  services: [string, ServiceState][],
  initialLines: number,
  verbose: boolean
): Promise<void> {
  // Show initial lines
  await showStaticLogs(services, initialLines, verbose);

  // Start tail -f for each file and prefix output
  const procs: ReturnType<typeof Bun.spawn>[] = [];

  for (const [name, service] of services) {
    const proc = Bun.spawn(["tail", "-f", "-n", "0", service!.logFile], {
      stdout: "pipe",
      stderr: "pipe",
    });

    procs.push(proc);

    // Read stdout and prefix each line
    (async () => {
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            console.log(formatLogLine(name, line, verbose));
          }
        }
      }
    })();
  }

  // Wait for Ctrl+C
  await new Promise(() => {});
}

export async function stopDev(): Promise<void> {
  const state = await loadDevState();

  if (state) {
    info("Stopping dev services...");

    // Stop all service processes
    for (const [name, service] of Object.entries(state.services)) {
      if (isProcessRunning(service.pid)) {
        try {
          process.kill(service.pid, "SIGTERM");
          console.log(dim(`  Stopped ${name} (pid ${service.pid})`));
        } catch {
          // Process already dead
        }
      }
    }

    // Wait briefly for graceful shutdown
    await Bun.sleep(1000);

    // Force kill any remaining
    for (const service of Object.values(state.services)) {
      if (isProcessRunning(service.pid)) {
        try {
          process.kill(service.pid, "SIGKILL");
        } catch {}
      }
    }

    // Stop docker containers if we started them
    if (state.dockerContainers.postgres) {
      info("Stopping PostgreSQL container...");
      await Bun.$`docker stop streams-dev-postgres`.quiet().nothrow();
      await Bun.$`docker rm streams-dev-postgres`.quiet().nothrow();
    }

    await clearDevState();
    success("Dev environment stopped");
    return;
  }

  // No state file — check for orphaned containers
  const pgOrphan = await isContainerRunning("streams-dev-postgres");

  if (!pgOrphan) {
    info("Dev environment is not running");
    return;
  }

  info("Cleaning up orphaned containers...");
  if (pgOrphan) {
    info("Stopping PostgreSQL container...");
    await Bun.$`docker stop streams-dev-postgres`.quiet().nothrow();
    await Bun.$`docker rm streams-dev-postgres`.quiet().nothrow();
  }
  success("Orphaned containers stopped");
}

export async function restartDev(): Promise<void> {
  const state = await loadDevState();
  if (!state) {
    info("Dev environment is not running");
    console.log(dim("Start with: sl local start"));
    return;
  }

  info("Restarting dev services...");

  // Stop all service processes (but keep docker containers)
  for (const [name, service] of Object.entries(state.services)) {
    if (isProcessRunning(service.pid)) {
      try {
        process.kill(service.pid, "SIGTERM");
        console.log(dim(`  Stopped ${name} (pid ${service.pid})`));
      } catch {
        // Process already dead
      }
    }
  }

  // Wait briefly for graceful shutdown
  await Bun.sleep(1000);

  // Force kill any remaining
  for (const service of Object.values(state.services)) {
    if (isProcessRunning(service.pid)) {
      try {
        process.kill(service.pid, "SIGKILL");
      } catch {}
    }
  }

  await clearDevState();
  await clearLogs();

  // Restart services with same config
  const config = await loadConfig();
  const packagesDir = dirname(dirname(dirname(dirname(import.meta.dir))));
  const env = state.env;

  const newState: DevState = {
    services: {},
    dockerContainers: state.dockerContainers,
    env: state.env,
    startedAt: new Date().toISOString(),
  };

  // API
  const apiPort = config.ports.api;
  const apiLogFile = getLogFile("api");
  const apiProc = Bun.spawn(["bun", "run", resolve(packagesDir, "packages/api/src/index.ts")], {
    env: { ...process.env, ...env, PORT: String(apiPort) },
    stdout: Bun.file(apiLogFile),
    stderr: Bun.file(apiLogFile),
  });
  newState.services.api = {
    pid: apiProc.pid,
    port: apiPort,
    startedAt: new Date().toISOString(),
    logFile: apiLogFile,
  };
  console.log(green("  ✓ API"), dim(`http://localhost:${apiPort}`));

  // Indexer
  const indexerPort = config.ports.indexer;
  const indexerLogFile = getLogFile("indexer");
  const indexerProc = Bun.spawn(["bun", "run", resolve(packagesDir, "packages/indexer/src/index.ts")], {
    env: { ...process.env, ...env, PORT: String(indexerPort) },
    stdout: Bun.file(indexerLogFile),
    stderr: Bun.file(indexerLogFile),
  });
  newState.services.indexer = {
    pid: indexerProc.pid,
    port: indexerPort,
    startedAt: new Date().toISOString(),
    logFile: indexerLogFile,
  };
  console.log(green("  ✓ Indexer"), dim(`http://localhost:${indexerPort}`));

  // Worker (if was running before)
  if (state.services.worker) {
    const workerLogFile = getLogFile("worker");
    const workerProc = Bun.spawn(["bun", "run", resolve(packagesDir, "packages/worker/src/index.ts")], {
      env: { ...process.env, ...env },
      stdout: Bun.file(workerLogFile),
      stderr: Bun.file(workerLogFile),
    });
    newState.services.worker = {
      pid: workerProc.pid,
      port: null,
      startedAt: new Date().toISOString(),
      logFile: workerLogFile,
    };
    console.log(green("  ✓ Worker"), dim("processing jobs"));
  }

  // Webhook (if was running before)
  if (state.services.webhook) {
    const webhookPort = config.ports.webhook;
    const webhookLogFile = getLogFile("webhook");
    const webhookProc = Bun.spawn(["bun", "run", resolve(packagesDir, "packages/cli/src/services/webhook-standalone.ts")], {
      env: { ...process.env as Record<string, string>, PORT: String(webhookPort) },
      stdout: Bun.file(webhookLogFile),
      stderr: Bun.file(webhookLogFile),
    });
    newState.services.webhook = {
      pid: webhookProc.pid,
      port: webhookPort,
      startedAt: new Date().toISOString(),
      logFile: webhookLogFile,
    };
    console.log(green("  ✓ Webhook server"), dim(`http://localhost:${webhookPort}`));
  }

  // View processor (always restart if was running)
  if (state.services.views) {
    const viewsLogFile = getLogFile("views");
    const viewsProc = Bun.spawn(["bun", "run", resolve(packagesDir, "packages/views/src/service.ts")], {
      env: { ...process.env, ...env },
      stdout: Bun.file(viewsLogFile),
      stderr: Bun.file(viewsLogFile),
    });
    newState.services.views = {
      pid: viewsProc.pid,
      port: null,
      startedAt: new Date().toISOString(),
      logFile: viewsLogFile,
    };
    console.log(green("  ✓ View processor"), dim("processing views"));
  }

  // Wait a bit for processes to start
  await Bun.sleep(500);

  // Verify processes are running
  for (const [name, service] of Object.entries(newState.services)) {
    if (!isProcessRunning(service.pid)) {
      error(`${name} failed to start`);
      process.exit(1);
    }
  }

  await saveDevState(newState);
  console.log("");
  success("Dev environment restarted");
  process.exit(0);
}

export async function showDevStatus(): Promise<void> {
  const state = await loadDevState();
  if (!state) {
    info("Dev environment is not running");
    console.log(dim("Start with: sl local start"));
    return;
  }

  const running = await getRunningServices();
  const runningCount = Object.keys(running).length;

  if (runningCount === 0) {
    info("Dev environment not running (stale state)");
    await clearDevState();
    return;
  }

  console.log("");
  console.log(blue("Dev Environment Status"));
  console.log("");
  printRunningServices(running);

  // Show Docker containers
  console.log("");
  console.log(blue("Docker Containers"));
  const pgRunning = await isContainerRunning("streams-dev-postgres");
  console.log(`  ${pgRunning ? green("✓") : red("✗")} PostgreSQL ${dim("streams-dev-postgres")}`);

  console.log("");
  console.log(dim(`Started: ${state.startedAt}`));
  console.log(dim(`Logs: ${getLogsDir()}`));
}

function printRunningServices(services: Record<string, ServiceState>): void {
  console.log(blue("Services"));
  for (const [name, service] of Object.entries(services)) {
    const portInfo = service.port ? dim(`http://localhost:${service.port}`) : dim("background");
    const status = isProcessRunning(service.pid) ? green("✓") : red("✗");
    console.log(`  ${status} ${name.padEnd(10)} ${portInfo} ${dim(`(pid ${service.pid})`)}`);
  }
}

async function isContainerRunning(name: string): Promise<boolean> {
  const result = await Bun.$`docker ps -q -f name=${name}`.quiet().nothrow();
  return result.stdout.toString().trim().length > 0;
}

function printBanner(): void {
  console.log("");
  console.log(blue("  ╔═══════════════════════════════════════╗"));
  console.log(blue("  ║") + "       Stacks Streams Dev Server       " + blue("║"));
  console.log(blue("  ╚═══════════════════════════════════════╝"));
  console.log("");
  console.log(dim("  Starting services..."));
  console.log("");
}

function printUrls(
  indexerPort: number,
  apiPort: number,
  webhookPort: number,
  webhookEnabled: boolean
): void {
  console.log(dim("  ─────────────────────────────────────────"));
  console.log("");
  console.log("  " + blue("API:"));
  console.log(`    List streams:   curl http://localhost:${apiPort}/streams`);
  console.log(`    Health check:   curl http://localhost:${apiPort}/health`);
  console.log("");
  console.log("  " + blue("Indexer:"));
  console.log(`    Health check:   curl http://localhost:${indexerPort}/health`);
  console.log(`    Send block:     curl -X POST http://localhost:${indexerPort}/new_block -d @block.json`);
  console.log("");

  if (webhookEnabled) {
    console.log("  " + blue("Test Webhook:"));
    console.log(`    Receives webhooks at http://localhost:${webhookPort}/`);
    console.log(`    Use this URL when creating streams for testing`);
    console.log("");
  }

  console.log("  " + blue("Stacks Node Config:"));
  console.log(dim("    Add to your Stacks node Config.toml:"));
  console.log("");
  console.log(yellow(`    [[events_observer]]`));
  console.log(yellow(`    endpoint = "host.docker.internal:${indexerPort}"`));
  console.log(yellow(`    events_keys = ["*"]`));
  console.log(yellow(`    timeout_ms = 300_000`));
  console.log("");
  console.log(dim("  ─────────────────────────────────────────"));
}

function logService(service: string, line: string): void {
  if (line.includes("DEBUG")) return;
  const prefix = dim(`[${service}]`);
  console.log(`${prefix} ${line}`);
}

async function isDatabaseReachable(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = parseInt(parsed.port || "5432");
    const socket = await Bun.$`pg_isready -h ${host} -p ${port}`.quiet().nothrow();
    if (socket.exitCode === 0) return true;
    // Fallback: try a TCP connection
    const conn = await Bun.connect({ hostname: host, port, socket: { data() {}, open(s) { s.end(); }, error() {} } }).catch(() => null);
    return conn !== null;
  } catch {
    return false;
  }
}


async function ensureDevPostgres(dataDir: string): Promise<boolean> {
  const check = await Bun.$`docker ps -q -f name=streams-dev-postgres`.quiet().nothrow();
  if (check.stdout.toString().trim()) {
    return false;
  }

  // Ensure data directory exists
  const pgDataDir = join(dataDir, "postgres");
  mkdirSync(pgDataDir, { recursive: true });

  const stopped = await Bun.$`docker ps -aq -f name=streams-dev-postgres`.quiet().nothrow();
  if (stopped.stdout.toString().trim()) {
    // Container exists but stopped - remove and recreate with correct volume
    await Bun.$`docker rm streams-dev-postgres`.quiet().nothrow();
  }

  // Create with volume mount for persistence
  await Bun.$`docker run -d --name streams-dev-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=streams_dev -v ${pgDataDir}:/var/lib/postgresql/data -p 5432:5432 postgres:16-alpine`.quiet();

  for (let i = 0; i < 30; i++) {
    const ready = await Bun.$`docker exec streams-dev-postgres pg_isready -U postgres`.quiet().nothrow();
    if (ready.exitCode === 0) return true;
    await Bun.sleep(500);
  }
  throw new Error("PostgreSQL failed to start");
}

async function runMigrations(databaseUrl: string): Promise<void> {
  const packagesDir = dirname(dirname(dirname(dirname(import.meta.dir))));
  const migrateScript = resolve(packagesDir, "packages/shared/src/db/migrate.ts");

  const result = await Bun.$`DATABASE_URL=${databaseUrl} bun run ${migrateScript}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`Migration failed: ${result.stderr.toString()}`);
  }
}
