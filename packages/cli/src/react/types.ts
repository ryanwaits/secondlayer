import type { NetworkName } from "../types/config";

/**
 * React-specific configuration types
 */

export interface SecondLayerReactConfig {
  /**
   * Network to use for API calls
   */
  network: NetworkName;

  /**
   * API key for Stacks API (optional)
   */
  apiKey?: string;

  /**
   * Base URL for Stacks API (optional override)
   */
  apiUrl?: string;

  /**
   * Default sender address for read-only calls
   */
  senderAddress?: string;
}
