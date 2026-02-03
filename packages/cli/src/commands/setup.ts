import { Command } from "commander";
import { select, input, confirm } from "@inquirer/prompts";
import { success, error, info } from "../lib/output.ts";
import { detectStacksNodes, type NodeInfo } from "../lib/detect.ts";
import { loadConfig, saveConfig, resolveApiUrl, type Config, type Network } from "../lib/config.ts";

const STREAMS_DIR = "streams";

interface InitOptions {
  detectOnly?: boolean;
  yes?: boolean;
  dataDir?: string;
  nodePath?: string;
  network?: "local" | "testnet" | "mainnet";
  webhookUrl?: string;
}

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Set up a streams project and configure settings")
    .option("--detect-only", "Only detect existing Stacks nodes, don't initialize")
    .option("-y, --yes", "Use defaults without prompts")
    .option("--data-dir <path>", "Data directory path")
    .option("--node-path <path>", "Path to Stacks node")
    .option("--network <network>", "Network (local, testnet, or mainnet)")
    .option("--webhook-url <url>", "Default webhook URL for new streams")
    .action(async (options: InitOptions) => {
      try {
        // Handle --detect-only flag
        if (options.detectOnly) {
          await runDetection();
          return;
        }

        // Non-interactive mode if --yes or any flags provided
        const hasFlags = options.yes || options.dataDir || options.nodePath || options.network || options.webhookUrl;
        if (hasFlags) {
          await runNonInteractive(options);
          return;
        }

        // Run interactive wizard
        await runWizard();
      } catch (err) {
        // Handle Ctrl+C gracefully
        if ((err as Error).name === "ExitPromptError") {
          console.log("\nSetup cancelled.");
          process.exit(0);
        }
        error(`Failed to initialize: ${err}`);
        process.exit(1);
      }
    });
}

/**
 * Run non-interactive setup with flags/defaults
 */
async function runNonInteractive(options: InitOptions): Promise<void> {
  const config = await loadConfig();
  const network = options.network || config.network || "mainnet";
  config.network = network as Network;

  // Hosted mode: authenticate via magic link
  if (network !== "local") {
    await saveConfig(config);
    const result = await hostedLogin(config);
    if (!result) process.exit(1);
    return;
  }

  // Local mode
  config.dataDir = options.dataDir || config.dataDir || "~/.secondlayer/data";
  config.defaultWebhookUrl = options.webhookUrl || config.defaultWebhookUrl;

  if (options.nodePath) {
    config.node = {
      installPath: options.nodePath,
      network: (options.network as "mainnet" | "testnet") || "mainnet",
    };
  }

  await saveConfig(config);

  await Bun.$`mkdir -p ${STREAMS_DIR}`.quiet();
  await Bun.write(`${STREAMS_DIR}/.gitkeep`, "");

  printSummary(config);
}

/**
 * Print the setup banner
 */
function printBanner(): void {
  console.log();
  console.log("  ╔═══════════════════════════════════════╗");
  console.log("  ║        SecondLayer CLI Setup           ║");
  console.log("  ╚═══════════════════════════════════════╝");
  console.log();
}

/**
 * Run the interactive setup wizard
 */
async function runWizard(): Promise<void> {
  printBanner();

  const config = await loadConfig();

  // Step 1: Network selection
  const network = await select({
    message: "How do you want to use Stacks Streams?",
    choices: [
      { name: "Hosted mainnet (recommended — zero setup)", value: "mainnet" as Network },
      { name: "Local development (run your own node + services)", value: "local" as Network },
    ],
  });

  config.network = network;

  // Hosted mode: authenticate via magic link
  if (network !== "local") {
    await saveConfig(config);
    const result = await hostedLogin(config);
    if (!result) process.exit(1);
    return;
  }

  // Local mode: existing wizard flow
  // Step 2: Data directory
  const dataDir = await promptDataDir(config);
  config.dataDir = dataDir;

  // Step 3: Node detection
  const nodeConfig = await promptNodeSetup();
  if (nodeConfig) {
    config.node = nodeConfig;
  }

  // Step 4: Webhook URL
  const webhookUrl = await promptWebhookUrl(config);
  config.defaultWebhookUrl = webhookUrl;

  // Save config
  await saveConfig(config);

  // Create streams directory
  await Bun.$`mkdir -p ${STREAMS_DIR}`.quiet();
  await Bun.write(`${STREAMS_DIR}/.gitkeep`, "");

  // Print summary
  printSummary(config);
}

/**
 * Prompt for data directory
 */
async function promptDataDir(config: Config): Promise<string> {
  const defaultDir = "~/.secondlayer/data";

  const choice = await select({
    message: "Where should streams store data?",
    choices: [
      { name: `Default (${defaultDir})`, value: "default" },
      { name: "Custom path...", value: "custom" },
    ],
  });

  if (choice === "default") {
    return defaultDir;
  }

  const customPath = await input({
    message: "Enter data directory path:",
    default: config.dataDir !== defaultDir ? config.dataDir : undefined,
    validate: (value) => {
      if (!value.trim()) return "Path cannot be empty";
      return true;
    },
  });

  return customPath;
}

/**
 * Prompt for Stacks node setup
 */
async function promptNodeSetup(): Promise<{ installPath: string; network: "mainnet" | "testnet" } | null> {
  const choice = await select({
    message: "Do you have an existing Stacks node?",
    choices: [
      { name: "Yes, auto-detect", value: "detect" },
      { name: "Yes, specify path", value: "manual" },
      { name: "No, skip for now", value: "skip" },
    ],
  });

  if (choice === "skip") {
    return null;
  }

  if (choice === "detect") {
    return await handleAutoDetect();
  }

  // Manual path entry
  const nodePath = await input({
    message: "Enter path to Stacks node:",
    validate: (value) => {
      if (!value.trim()) return "Path cannot be empty";
      return true;
    },
  });

  const network = await promptNetwork();

  return { installPath: nodePath, network };
}

/**
 * Handle auto-detection flow
 */
async function handleAutoDetect(): Promise<{ installPath: string; network: "mainnet" | "testnet" } | null> {
  info("Scanning for Stacks nodes...\n");

  const nodes = await detectStacksNodes();

  if (nodes.length === 0) {
    console.log("  No Stacks nodes found.\n");

    const retry = await select({
      message: "What would you like to do?",
      choices: [
        { name: "Enter path manually", value: "manual" },
        { name: "Skip for now", value: "skip" },
      ],
    });

    if (retry === "skip") {
      return null;
    }

    const nodePath = await input({
      message: "Enter path to Stacks node:",
      validate: (value) => {
        if (!value.trim()) return "Path cannot be empty";
        return true;
      },
    });

    const network = await promptNetwork();
    return { installPath: nodePath, network };
  }

  // Show found nodes
  console.log(`Found ${nodes.length} Stacks node${nodes.length > 1 ? "s" : ""}:\n`);

  for (const node of nodes) {
    printNodeInfo(node);
  }

  // If only one node, confirm it
  if (nodes.length === 1) {
    const useNode = await confirm({
      message: `Use this node?`,
      default: true,
    });

    if (useNode) {
      return { installPath: nodes[0]!.path, network: nodes[0]!.network };
    }

    return null;
  }

  // Multiple nodes - let user select
  const choices = [
    ...nodes.map((node) => ({
      name: `${node.path} (${node.network}${node.running ? ", running" : ""})`,
      value: node.path,
    })),
    { name: "None of these", value: "none" },
  ];

  const selectedPath = await select({
    message: "Which node should streams use?",
    choices,
  });

  if (selectedPath === "none") {
    return null;
  }

  const selectedNode = nodes.find((n) => n.path === selectedPath);
  if (!selectedNode) return null;

  return { installPath: selectedNode.path, network: selectedNode.network };
}

/**
 * Prompt for network selection
 */
async function promptNetwork(): Promise<"mainnet" | "testnet"> {
  const network = await select({
    message: "Which network?",
    choices: [
      { name: "mainnet", value: "mainnet" as const },
      { name: "testnet", value: "testnet" as const },
    ],
  });

  return network;
}

/**
 * Prompt for default webhook URL
 */
async function promptWebhookUrl(config: Config): Promise<string> {
  const internalUrl = "http://localhost:3900/webhook";

  const choice = await select({
    message: "Default webhook URL for new streams?",
    choices: [
      { name: `Internal test server (${internalUrl})`, value: "internal" },
      { name: "Custom URL...", value: "custom" },
    ],
  });

  if (choice === "internal") {
    return internalUrl;
  }

  const customUrl = await input({
    message: "Enter webhook URL:",
    default: config.defaultWebhookUrl !== internalUrl ? config.defaultWebhookUrl : undefined,
    validate: (value) => {
      if (!value.trim()) return "URL cannot be empty";
      try {
        new URL(value);
        return true;
      } catch {
        return "Must be a valid URL";
      }
    },
  });

  return customUrl;
}

/**
 * Hosted login via magic link email flow
 */
async function hostedLogin(config: Config): Promise<boolean> {
  const apiUrl = resolveApiUrl(config);

  info(`Connecting to ${config.network} API...`);
  console.log();

  const email = await input({
    message: "Email address:",
    validate: (v) => v.includes("@") || "Enter a valid email",
  });

  const mlRes = await fetch(`${apiUrl}/api/auth/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!mlRes.ok) {
    const body = await mlRes.text();
    let msg = `HTTP ${mlRes.status}`;
    try { msg = JSON.parse(body).error || msg; } catch {}
    error(`Failed to send magic link: ${msg}`);
    return false;
  }

  info("Check your email for a login token.");

  const token = await input({
    message: "Paste token from email:",
    validate: (v) => v.trim().length > 0 || "Token is required",
  });

  const verifyRes = await fetch(`${apiUrl}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token.trim() }),
  });

  if (!verifyRes.ok) {
    const body = await verifyRes.text();
    let msg = `HTTP ${verifyRes.status}`;
    try { msg = JSON.parse(body).error || msg; } catch {}
    error(`Verification failed: ${msg}`);
    return false;
  }

  const result = await verifyRes.json() as {
    sessionToken: string;
    account: { id: string; email: string; plan: string };
  };

  config.sessionToken = result.sessionToken;
  await saveConfig(config);

  const account = result.account;

  console.log();
  success(`Authenticated as ${account.email}!`);
  console.log();
  console.log(`  Plan:    ${account.plan}`);
  console.log(`  API:     ${apiUrl}`);
  console.log();
  console.log("  Next steps:");
  console.log("    sl streams list         # List streams");
  console.log("    sl streams new <name>   # Create a stream");
  console.log("    sl auth status          # Check auth status");
  console.log();
  return true;
}

/**
 * Print setup summary
 */
function printSummary(config: Config): void {
  console.log();
  success("Configuration saved!");
  console.log();
  console.log("  Settings:");
  console.log(`    Data directory: ${config.dataDir}`);
  if (config.defaultWebhookUrl) {
    console.log(`    Webhook URL:    ${config.defaultWebhookUrl}`);
  }
  if (config.node) {
    console.log(`    Node path:      ${config.node.installPath}`);
    console.log(`    Network:        ${config.node.network}`);
  }
  console.log();
  console.log("  Next steps:");
  console.log("    sl dev start            # Start dev services");
  if (config.node) {
    console.log("    sl node start           # Start your Stacks node");
  }
  console.log("    sl streams new <name>   # Create a new stream config");
  console.log();
}

/**
 * Run node detection and display results
 */
async function runDetection(): Promise<void> {
  info("Scanning for Stacks nodes...\n");

  const nodes = await detectStacksNodes();

  if (nodes.length === 0) {
    console.log("  No Stacks nodes found.\n");
    console.log("Checked locations:");
    console.log("  - Running Docker containers");
    console.log("  - /Volumes/*/stacks-blockchain-docker");
    console.log("  - ~/stacks-blockchain-docker");
    console.log("  - /opt/stacks-*\n");
    console.log("To set up a node manually:");
    console.log("  sl config set node.installPath /path/to/node");
    return;
  }

  console.log(`Found ${nodes.length} Stacks node${nodes.length > 1 ? "s" : ""}:\n`);

  for (const node of nodes) {
    printNodeInfo(node);
  }
}

/**
 * Print formatted node info
 */
function printNodeInfo(node: NodeInfo): void {
  const status = node.running ? "\x1b[32m●\x1b[0m running" : "\x1b[90m○\x1b[0m stopped";
  const source = node.source === "container" ? "docker" : "filesystem";

  console.log(`  ${status}  ${node.path}`);
  console.log(`           network: ${node.network}, source: ${source}\n`);
}
