/**
 * Stacks node detection utilities
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { isDockerAvailable } from "./docker.ts";

export interface NodeInfo {
  path: string;
  network: "mainnet" | "testnet";
  running: boolean;
  source: "container" | "filesystem";
}

// Common container name patterns for stacks-blockchain-docker
const STACKS_CONTAINER_PATTERNS = [
  "stacks-blockchain",
  "stacks-node",
  "stacks_blockchain",
  "stacks_node",
];

/**
 * Detect running Stacks node containers
 */
export async function detectRunningContainers(): Promise<NodeInfo | null> {
  try {
    // Get all running containers
    const psResult = await Bun.$`docker ps --format "{{.Names}}"`.quiet().nothrow();
    if (psResult.exitCode !== 0) {
      return null;
    }

    const containers = psResult.stdout.toString().trim().split("\n").filter(Boolean);

    // Find stacks-related container
    const stacksContainer = containers.find((name) =>
      STACKS_CONTAINER_PATTERNS.some((pattern) =>
        name.toLowerCase().includes(pattern.toLowerCase())
      )
    );

    if (!stacksContainer) {
      return null;
    }

    // Inspect container for mount info and labels
    const inspectResult = await Bun.$`docker inspect ${stacksContainer}`.quiet().nothrow();
    if (inspectResult.exitCode !== 0) {
      return null;
    }

    const inspectData = JSON.parse(inspectResult.stdout.toString());
    if (!Array.isArray(inspectData) || inspectData.length === 0) {
      return null;
    }

    const container = inspectData[0];

    // Extract path from bind mounts
    const path = await extractPathFromMounts(container);
    if (!path) {
      return null;
    }

    // Detect network from environment or labels
    const network = detectNetworkFromContainer(container);

    return {
      path,
      network,
      running: true,
      source: "container",
    };
  } catch {
    return null;
  }
}

/**
 * Extract the stacks node path from container mount bindings
 */
async function extractPathFromMounts(container: { Mounts?: Mount[]; HostConfig?: { Binds?: string[] } }): Promise<string | null> {
  // Check Mounts array first (modern docker format)
  if (container.Mounts && Array.isArray(container.Mounts)) {
    for (const mount of container.Mounts) {
      if (mount.Type === "bind" && mount.Source) {
        // Look for stacks-related paths
        if (
          mount.Source.includes("stacks-blockchain") ||
          mount.Source.includes("stacks-node") ||
          mount.Destination?.includes("/stacks")
        ) {
          // Find the docker-compose project root
          return await findDockerComposeRoot(mount.Source);
        }
      }
    }
  }

  // Fallback to HostConfig.Binds (legacy format)
  const binds = container.HostConfig?.Binds;
  if (binds && Array.isArray(binds)) {
    for (const bind of binds) {
      const [source] = bind.split(":");
      if (source && (source.includes("stacks-blockchain") || source.includes("stacks-node"))) {
        return await findDockerComposeRoot(source);
      }
    }
  }

  return null;
}

/**
 * Find the stacks node project root from a mount path
 */
async function findDockerComposeRoot(startPath: string): Promise<string | null> {
  // First try: look for docker-compose.yml by traversing up
  let current = startPath;
  while (current && current !== "/") {
    try {
      const composeYml = Bun.file(join(current, "docker-compose.yml"));
      const composeYaml = Bun.file(join(current, "docker-compose.yaml"));

      if ((await composeYml.exists()) || (await composeYaml.exists())) {
        return current;
      }
    } catch {
      // Permission denied or other error, continue
    }

    current = getParentPath(current);
  }

  // Second try: find known directory patterns in path
  const knownPatterns = ["stacks-blockchain-docker", "stacks-node"];
  for (const pattern of knownPatterns) {
    const idx = startPath.indexOf(pattern);
    if (idx !== -1) {
      return startPath.substring(0, idx + pattern.length);
    }
  }

  // Fallback: return parent of original path
  return getParentPath(startPath);
}

interface Mount {
  Type: string;
  Source: string;
  Destination?: string;
}

/**
 * Get parent directory path
 */
function getParentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

/**
 * Detect network from container environment variables or labels
 */
function detectNetworkFromContainer(container: {
  Config?: { Env?: string[]; Labels?: Record<string, string> };
}): "mainnet" | "testnet" {
  const config = container.Config;

  // Check environment variables
  if (config?.Env) {
    for (const env of config.Env) {
      const lower = env.toLowerCase();
      if (lower.includes("network=testnet") || lower.includes("stacks_network=testnet")) {
        return "testnet";
      }
      if (lower.includes("network=mainnet") || lower.includes("stacks_network=mainnet")) {
        return "mainnet";
      }
    }
  }

  // Check labels
  if (config?.Labels) {
    const networkLabel = config.Labels["network"] || config.Labels["stacks.network"];
    if (networkLabel === "testnet") {
      return "testnet";
    }
  }

  // Default to mainnet
  return "mainnet";
}

// Search patterns for stacks node installations
const SEARCH_PATTERNS = [
  "/Volumes/stacks-blockchain-docker",
  "/Volumes/stacks-node",
  "/Volumes/*/stacks-blockchain-docker",
  "/Volumes/*/stacks-node",
  `${homedir()}/stacks-blockchain-docker`,
  `${homedir()}/stacks-node`,
  `${homedir()}/stacks-*`,
  "/opt/stacks-blockchain-docker",
  "/opt/stacks-node",
  "/opt/stacks-*",
];

/**
 * Scan filesystem for Stacks node installations
 */
export async function scanFilesystemPaths(): Promise<NodeInfo[]> {
  const nodes: NodeInfo[] = [];
  const checkedPaths = new Set<string>();

  for (const pattern of SEARCH_PATTERNS) {
    const paths = await expandGlobPattern(pattern);
    for (const path of paths) {
      // Skip if already checked
      if (checkedPaths.has(path)) continue;
      checkedPaths.add(path);

      // Validate this is a stacks node directory
      const isValid = await isValidStacksNodeDir(path);
      if (!isValid) continue;

      // Detect network from config files
      const network = await detectNetworkFromFilesystem(path);

      // Check if running by looking for compose project
      const running = await isComposeProjectRunning(path);

      nodes.push({
        path,
        network,
        running,
        source: "filesystem",
      });
    }
  }

  return nodes;
}

/**
 * Expand glob pattern to list of paths
 */
async function expandGlobPattern(pattern: string): Promise<string[]> {
  try {
    // Use bash -c so the glob in `pattern` actually expands
    // (Bun.$ escapes interpolated values, preventing glob expansion)
    const result = await Bun.$`bash -c ${`ls -d ${pattern} 2>/dev/null`}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      return [];
    }
    return result.stdout.toString().trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Check if a directory is a valid stacks node installation
 */
async function isValidStacksNodeDir(path: string): Promise<boolean> {
  // If the directory name itself is stacks-related, trust it
  // (handles cases where we can't read contents due to permissions)
  const dirName = path.split("/").filter(Boolean).pop() ?? "";
  if (dirName.includes("stacks-blockchain") || dirName.includes("stacks-node")) {
    return true;
  }

  // Otherwise, check for docker-compose.yml with stacks services
  try {
    const composeYml = Bun.file(join(path, "docker-compose.yml"));
    const composeYaml = Bun.file(join(path, "docker-compose.yaml"));

    const hasCompose = (await composeYml.exists()) || (await composeYaml.exists());
    if (!hasCompose) {
      return false;
    }

    const composeFile = (await composeYml.exists()) ? composeYml : composeYaml;
    const content = await composeFile.text();
    return (
      content.includes("stacks-blockchain") ||
      content.includes("stacks-node") ||
      content.includes("blockstack/stacks-blockchain") ||
      content.includes("hirosystems/stacks-blockchain")
    );
  } catch {
    // Permission denied — can't verify, but don't reject
    return false;
  }
}

/**
 * Detect network from stacks node configuration files
 */
async function detectNetworkFromFilesystem(path: string): Promise<"mainnet" | "testnet"> {
  // Check .env file
  const envFile = Bun.file(join(path, ".env"));
  if (await envFile.exists()) {
    try {
      const content = await envFile.text();
      if (content.includes("NETWORK=testnet") || content.includes("STACKS_NETWORK=testnet")) {
        return "testnet";
      }
      if (content.includes("NETWORK=mainnet") || content.includes("STACKS_NETWORK=mainnet")) {
        return "mainnet";
      }
    } catch {}
  }

  // Check for network-specific config directories
  const testnetConfig = Bun.file(join(path, "configurations/testnet"));
  const mainnetConfig = Bun.file(join(path, "configurations/mainnet"));

  // Silence unused-variable warnings for config file references (used for detection)
  void testnetConfig;
  void mainnetConfig;

  // Check which configs are being used (symlinks or active)
  const activeConfig = Bun.file(join(path, "configurations/active"));
  if (await activeConfig.exists()) {
    try {
      const result = await Bun.$`readlink ${join(path, "configurations/active")}`.quiet().nothrow();
      const link = result.stdout.toString().trim();
      if (link.includes("testnet")) return "testnet";
    } catch {}
  }

  // Check directory name for hints
  if (path.toLowerCase().includes("testnet")) {
    return "testnet";
  }

  // Default to mainnet
  return "mainnet";
}

/**
 * Check if docker-compose project is running
 */
async function isComposeProjectRunning(path: string): Promise<boolean> {
  try {
    const result = await Bun.$`docker compose -f ${join(path, "docker-compose.yml")} ps -q`.quiet().nothrow();
    return result.exitCode === 0 && result.stdout.toString().trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Orchestrate all detection methods and return found nodes
 */
export async function detectStacksNodes(): Promise<NodeInfo[]> {
  const nodes: NodeInfo[] = [];

  // Check running containers first
  if (await isDockerAvailable()) {
    const containerNode = await detectRunningContainers();
    if (containerNode) {
      nodes.push(containerNode);
    }
  }

  // Scan filesystem paths
  const filesystemNodes = await scanFilesystemPaths();

  // Deduplicate by path (prefer running containers over filesystem)
  const seenPaths = new Set(nodes.map((n) => n.path));
  for (const node of filesystemNodes) {
    if (!seenPaths.has(node.path)) {
      nodes.push(node);
      seenPaths.add(node.path);
    }
  }

  return nodes;
}
