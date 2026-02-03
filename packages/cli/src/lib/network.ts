import type { Config } from "./config.ts";

export const CHAIN_IDS = {
  mainnet: { hex: "0x00000001", decimal: 1 },
  testnet: { hex: "0x80000000", decimal: 2147483648 },
} as const;

export type Network = keyof typeof CHAIN_IDS;

export function getChainId(network: Network): string {
  return CHAIN_IDS[network].decimal.toString();
}

export function getChainIdHex(network: Network): string {
  return CHAIN_IDS[network].hex;
}

/**
 * Map RPC network_id to network name.
 * Stacks RPC returns network_id = 1 for mainnet, 2147483648 for testnet.
 */
export function networkFromId(networkId: number): Network | null {
  if (networkId === CHAIN_IDS.mainnet.decimal) return "mainnet";
  if (networkId === CHAIN_IDS.testnet.decimal) return "testnet";
  return null;
}

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Validate that the configured network matches the running node's actual chain ID.
 * Checks RPC /v2/info, container env, and node .env file.
 */
export async function validateNetworkConsistency(config: Config): Promise<ValidationResult> {
  const issues: string[] = [];
  const network = config.node?.network;

  if (!network) {
    return { valid: true, issues: [] };
  }

  const expected = CHAIN_IDS[network].decimal;

  // Check RPC /v2/info
  try {
    const res = await fetch("http://localhost:20443/v2/info", {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const info = (await res.json()) as { network_id: number };
      if (info.network_id !== expected) {
        const actual = networkFromId(info.network_id);
        issues.push(
          `RPC reports network_id=${info.network_id} (${actual ?? "unknown"}) but config says ${network} (${expected})`
        );
      }
    }
  } catch {
    // Node not responding — skip
  }

  // Check container env via docker inspect
  try {
    const result = await Bun.$`docker inspect --format={{.Config.Env}} stacks-blockchain`.quiet().nothrow();
    if (result.exitCode === 0) {
      const envStr = result.stdout.toString();
      const match = envStr.match(/STACKS_CHAIN_ID=(0x[0-9a-fA-F]+|\d+)/);
      if (match) {
        const containerId = parseInt(match[1]!, match[1]!.startsWith("0x") ? 16 : 10);
        if (containerId !== expected) {
          issues.push(
            `Container STACKS_CHAIN_ID=${containerId} but config expects ${expected} (${network})`
          );
        }
      }
    }
  } catch {
    // No container or docker not available
  }

  // Check node .env file
  if (config.node?.installPath) {
    try {
      const envFile = Bun.file(`${config.node.installPath}/.env`);
      if (await envFile.exists()) {
        const content = await envFile.text();
        const match = content.match(/STACKS_CHAIN_ID=(0x[0-9a-fA-F]+|\d+)/);
        if (match) {
          const fileId = parseInt(match[1]!, match[1]!.startsWith("0x") ? 16 : 10);
          if (fileId !== expected) {
            issues.push(
              `Node .env STACKS_CHAIN_ID=${fileId} but config expects ${expected} (${network})`
            );
          }
        }
      }
    } catch {
      // Can't read .env
    }
  }

  return { valid: issues.length === 0, issues };
}
