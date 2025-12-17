import type { SecondLayerReactConfig } from "./types";

/**
 * Create a SecondLayer React configuration
 */
export function createSecondLayerConfig(
  config: SecondLayerReactConfig
): SecondLayerReactConfig {
  return {
    network: config.network,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    senderAddress: config.senderAddress || "SP000000000000000000002Q6VF78",
  };
}
