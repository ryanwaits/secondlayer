import type { StacksReactConfig } from "./types";

/**
 * Create a Stacks React configuration
 */
export function createStacksConfig(
  config: StacksReactConfig
): StacksReactConfig {
  return {
    network: config.network,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    senderAddress: config.senderAddress || "SP000000000000000000002Q6VF78",
  };
}
