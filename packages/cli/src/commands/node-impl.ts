/**
 * Node command implementation - extracted from node.ts for use by local.ts
 */
import { input, select, confirm } from "@inquirer/prompts";
import { loadConfig, saveConfig } from "../lib/config.ts";
import {
  isDockerRunning,
  validateNodePath,
  runManageScript,
  startNodeContainers,
  isNodeRunning,
  getNodeContainers,
  stopNodeContainers,
} from "../lib/node-manager.ts";
import {
  error,
  success,
  warn,
  info,
  green,
  red,
  yellow,
  dim,
  blue,
  formatKeyValue,
} from "../lib/output.ts";
import { pauseAllStreams, getQueueStats } from "../lib/api-client.ts";
import { validateNetworkConsistency, getChainIdHex } from "../lib/network.ts";

interface NodeInfo {
  network_id: number;
  stacks_tip_height?: number;
  burn_block_height?: number;
  server_version?: string;
}

interface PeerInfo {
  inbound?: unknown[];
  outbound?: unknown[];
}

const DEFAULT_RPC_PORT = 20443;

export async function runSetupWizard(): Promise<void> {
  console.log("");
  console.log(blue("Stacks Node Setup Wizard"));
  console.log(dim("Configure your Stacks node integration"));
  console.log("");

  // Step 1: Check Docker
  info("Checking Docker...");
  const dockerOk = await isDockerRunning();
  if (!dockerOk) {
    error("Docker is not running");
    console.log("");
    console.log(dim("Please start Docker and try again:"));
    console.log(dim("  macOS: open -a Docker"));
    console.log(dim("  Linux: sudo systemctl start docker"));
    process.exit(1);
  }
  success("Docker is running");
  console.log("");

  // Step 2: Node installation path
  const installPath = await input({
    message: "Where is stacks-blockchain-docker installed?",
    validate: async (value) => {
      if (!value.trim()) return "Path is required";
      const result = await validateNodePath(value.trim());
      if (!result.valid) return result.error || "Invalid path";
      return true;
    },
  });

  // Step 3: Network selection
  const network = await select({
    message: "Which network?",
    choices: [
      { name: "mainnet", value: "mainnet" as const },
      { name: "testnet", value: "testnet" as const },
    ],
    default: "mainnet",
  });

  // Step 4: Auto-start indexer
  const autoStartIndexer = await confirm({
    message: "Auto-start streams indexer when node starts?",
    default: true,
  });

  let indexerPort = 3700;
  if (autoStartIndexer) {
    const customPort = await confirm({
      message: "Use default indexer port (3700)?",
      default: true,
    });
    if (!customPort) {
      const portInput = await input({
        message: "Enter custom indexer port:",
        default: "3700",
        validate: (value) => {
          const port = parseInt(value);
          if (isNaN(port) || port < 1 || port > 65535) {
            return "Invalid port number";
          }
          return true;
        },
      });
      indexerPort = parseInt(portInput);
    }
  }

  // Save configuration
  const config = await loadConfig();
  config.node = {
    installPath,
    network,
  };
  config.ports = {
    ...config.ports,
    indexer: indexerPort,
  };
  await saveConfig(config);

  console.log("");
  success("Configuration saved!");
  console.log("");
  console.log(dim("Settings:"));
  console.log(
    formatKeyValue([
      ["  Install path", installPath],
      ["  Network", network],
      ["  Auto-start indexer", autoStartIndexer ? `Yes (port ${indexerPort})` : "No"],
    ])
  );
  console.log("");
  console.log(dim("Next steps:"));
  console.log("  " + green("sl local node start") + dim("  - Start the Stacks node"));
  console.log("  " + green("sl local node status") + dim(" - Check sync progress"));
  console.log("  " + green("sl local node logs") + dim("   - View logs"));
  console.log("");
}

export async function startNode(pathOverride?: string, withIndexer?: boolean): Promise<void> {
  const config = await loadConfig();
  const nodePath = pathOverride || config.node?.installPath;
  const network = config.node?.network || "mainnet";

  if (!nodePath) {
    error("Node not configured");
    console.log(dim("Run 'sl local node setup' or use --path flag"));
    process.exit(1);
  }

  // Check Docker
  if (!(await isDockerRunning())) {
    error("Docker is not running");
    process.exit(1);
  }

  // Check if already running
  if (await isNodeRunning()) {
    info("Node is already running");
    console.log(dim("Run 'sl local node logs' to view output"));
    console.log(dim("Run 'sl local node stop' to stop"));
    return;
  }

  // Validate network consistency before starting
  const validation = await validateNetworkConsistency(config);
  if (!validation.valid) {
    error("Network mismatch detected:");
    for (const issue of validation.issues) {
      console.log(red(`  - ${issue}`));
    }
    console.log("");
    console.log(dim("Fix your config or stop mismatched containers first."));
    process.exit(1);
  }

  console.log("");
  info(`Starting Stacks node (${network})...`);
  console.log(dim(`Path: ${nodePath}`));
  console.log("");

  const result = await runManageScript(nodePath, network, "start");

  if (result.exitCode !== 0) {
    error("Failed to start node");
    console.log(dim(result.stderr));
    process.exit(1);
  }

  success("Node started!");
  console.log("");

  // Optionally start indexer
  if (withIndexer) {
    const port = config.ports?.indexer || 3700;
    console.log(dim(`Tip: Start indexer with: sl local start`));
    console.log(dim(`    Or manually: PORT=${port} bun run packages/indexer/src/index.ts`));
    console.log("");
  }

  console.log(dim("Next steps:"));
  console.log("  " + green("sl local node status") + dim(" - Check sync progress"));
  console.log("  " + green("sl local node logs -f") + dim(" - Follow logs"));
  console.log("");
}

export async function stopNode(_pathOverride?: string, force?: boolean, wait?: boolean): Promise<void> {
  // Check if running
  if (!(await isNodeRunning())) {
    info("Node is not running");
    return;
  }

  if (!force) {
    const proceed = await confirm({
      message: "Stop the Stacks node?",
      default: false,
    });
    if (!proceed) {
      info("Cancelled");
      return;
    }
  }

  console.log("");

  // If --wait, pause streams and wait for queue to drain
  if (wait) {
    await pauseAndWait();
  }

  info("Stopping Stacks node...");

  const stopped = await stopNodeContainers();

  if (stopped.length === 0) {
    error("Failed to stop any containers");
    process.exit(1);
  }

  success(`Stopped: ${stopped.join(", ")}`);
}

export async function restartNode(pathOverride?: string, force?: boolean, wait?: boolean): Promise<void> {
  const config = await loadConfig();
  const nodePath = pathOverride || config.node?.installPath;
  const network = config.node?.network || "mainnet";

  if (!nodePath) {
    error("Node not configured");
    console.log(dim("Run 'sl local node setup' or use --path flag"));
    process.exit(1);
  }

  const wasRunning = await isNodeRunning();

  if (wasRunning) {
    if (!force) {
      const proceed = await confirm({
        message: "Restart the Stacks node?",
        default: false,
      });
      if (!proceed) {
        info("Cancelled");
        return;
      }
    }

    console.log("");

    // If --wait, pause streams and wait for queue to drain
    if (wait) {
      await pauseAndWait();
    }

    info("Stopping Stacks node...");
    const stopped = await stopNodeContainers();
    if (stopped.length > 0) {
      success(`Stopped: ${stopped.join(", ")}`);
    }
    console.log("");
  }

  info(`Starting Stacks node (${network})...`);
  console.log(dim(`Path: ${nodePath}`));
  console.log("");

  const started = await startNodeContainers(nodePath, network);

  if (!started) {
    // Fallback to manage.sh
    info("Docker compose failed, falling back to manage.sh...");
    const result = await runManageScript(nodePath, network, "start");
    if (result.exitCode !== 0) {
      error("Failed to start node");
      console.log(dim(result.stderr));
      process.exit(1);
    }
  }

  success("Node started!");
  console.log("");
  console.log(dim("Next steps:"));
  console.log("  " + green("sl local node status") + dim(" - Check sync progress"));
  console.log("  " + green("sl local node logs -f") + dim(" - Follow logs"));
  console.log("");
}

async function pauseAndWait(): Promise<void> {
  const POLL_INTERVAL_MS = 1000;

  try {
    info("Pausing streams...");
    const result = await pauseAllStreams();

    if (result.paused > 0) {
      success(`Paused ${result.paused} stream${result.paused === 1 ? "" : "s"}`);
    }

    process.stdout.write(dim("Waiting for jobs to complete..."));

    while (true) {
      const stats = await getQueueStats();
      const active = stats.pending + stats.processing;

      if (active === 0) {
        process.stdout.write("\n");
        success("All jobs completed");
        console.log("");
        return;
      }

      process.stdout.write(`\r${dim(`Waiting for jobs to complete... ${active} remaining`)}`);
      await Bun.sleep(POLL_INTERVAL_MS);
    }
  } catch {
    warn("Could not pause streams (API may not be running)");
    console.log("");
  }
}

export async function showStatus(pathOverride?: string, jsonOutput?: boolean): Promise<void> {
  const config = await loadConfig();
  const nodePath = pathOverride || config.node?.installPath;
  const network = config.node?.network || "mainnet";

  if (!nodePath) {
    error("Node not configured");
    console.log(dim("Run 'sl local node setup' or use --path flag"));
    process.exit(1);
  }

  const running = await isNodeRunning();
  const containers = running ? await getNodeContainers() : [];

  // Try to get node info
  let nodeInfo: NodeInfo | null = null;
  let peerCount = 0;

  if (running) {
    try {
      const infoRes = await fetch(`http://localhost:${DEFAULT_RPC_PORT}/v2/info`, {
        signal: AbortSignal.timeout(5000),
      });
      if (infoRes.ok) {
        nodeInfo = (await infoRes.json()) as NodeInfo;
      }

      const peerRes = await fetch(`http://localhost:${DEFAULT_RPC_PORT}/v2/neighbors`, {
        signal: AbortSignal.timeout(5000),
      });
      if (peerRes.ok) {
        const peers = (await peerRes.json()) as PeerInfo;
        peerCount = (peers.inbound?.length || 0) + (peers.outbound?.length || 0);
      }
    } catch {
      // Node not responding yet
    }
  }

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          running,
          network,
          installPath: nodePath,
          containers,
          nodeInfo,
          peerCount,
        },
        null,
        2
      )
    );
    return;
  }

  console.log("");
  console.log(blue("Stacks Node Status"));
  console.log("");

  // Validate chain ID consistency
  const validation = await validateNetworkConsistency(config);
  const chainIdHex = getChainIdHex(network as "mainnet" | "testnet");
  const chainIdStatus = validation.valid ? green("valid") : red("MISMATCH");

  console.log(
    formatKeyValue([
      ["  Status", running ? green("Running") : red("Stopped")],
      ["  Network", network],
      ["  Chain ID", `${chainIdHex} (${chainIdStatus})`],
      ["  Path", dim(nodePath)],
    ])
  );

  if (!validation.valid) {
    console.log("");
    warn("Chain ID issues:");
    for (const issue of validation.issues) {
      console.log(yellow(`  - ${issue}`));
    }
  }
  console.log("");

  if (nodeInfo) {
    console.log(blue("Chain Info"));
    console.log(
      formatKeyValue([
        ["  Stacks Height", nodeInfo.stacks_tip_height?.toString() || "syncing..."],
        ["  Burn Height", nodeInfo.burn_block_height?.toString() || "syncing..."],
        ["  Peers", peerCount.toString()],
        ["  Version", nodeInfo.server_version || "unknown"],
      ])
    );
    console.log("");
  } else if (running) {
    warn("Node is starting up (RPC not responding yet)");
    console.log(dim("This is normal during initial sync"));
    console.log("");
  }

  if (containers.length > 0) {
    console.log(blue("Services"));
    for (const container of containers) {
      const statusIcon = container.status.includes("Up") ? green("+") : yellow("~");
      console.log(`  ${statusIcon} ${container.name} ${dim(`(${container.status})`)}`);
    }
    console.log("");
  }

  // Indexer status
  const indexerPort = config.ports?.indexer || 3700;
  try {
    const indexerRes = await fetch(`http://localhost:${indexerPort}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (indexerRes.ok) {
      console.log(blue("Streams Indexer"));
      console.log(`  ${green("+")} Running on port ${indexerPort}`);
      console.log("");
    }
  } catch {
    // Indexer not running - only show message if node is configured
    if (config.node) {
      console.log(blue("Streams Indexer"));
      console.log(`  ${dim("-")} ${dim(`Not running (expected on port ${indexerPort})`)}`);
      console.log(dim(`    Start with: sl local start`));
      console.log("");
    }
  }
}

export async function showConfig(): Promise<void> {
  const config = await loadConfig();

  console.log("");
  console.log(blue("Node Configuration"));
  console.log("");

  if (!config.node?.installPath) {
    warn("Node not configured");
    console.log(dim("Run 'sl local node setup' to configure"));
    console.log("");
    return;
  }

  console.log(
    formatKeyValue([
      ["  Install path", config.node.installPath],
      ["  Network", config.node.network || "mainnet"],
      ["  Indexer port", config.ports?.indexer?.toString() || "3700"],
    ])
  );
  console.log("");
  console.log(dim("Config file: ~/.secondlayer/config.json"));
  console.log(dim("Run 'sl local node config --edit' to modify"));
  console.log("");
}

export async function showConfigCheck(indexerPort: number): Promise<void> {
  console.log("");
  console.log(blue("Events Observer Configuration"));
  console.log("");
  console.log(dim("Add the following to your Stacks node's Config.toml:"));
  console.log("");
  console.log(yellow("[[events_observer]]"));
  console.log(yellow(`endpoint = "host.docker.internal:${indexerPort}"`));
  console.log(yellow('events_keys = ["*"]'));
  console.log(yellow("timeout_ms = 300_000"));
  console.log("");
  console.log(dim("Notes:"));
  console.log(dim("  - Use 'host.docker.internal' if node runs in Docker"));
  console.log(dim("  - Use 'localhost' if node runs directly on host"));
  console.log(dim("  - Restart the node after modifying Config.toml"));
  console.log("");

  // Check if indexer is running
  try {
    const res = await fetch(`http://localhost:${indexerPort}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      success(`Indexer is running on port ${indexerPort}`);
    }
  } catch {
    warn(`Indexer not detected on port ${indexerPort}`);
    console.log(dim("Start with: sl local start"));
  }
  console.log("");
}
