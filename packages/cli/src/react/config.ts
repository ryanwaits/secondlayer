import { DEFAULT_SENDER_ADDRESS } from "../utils/constants";
import type { SecondLayerReactConfig } from "./types";

/**
 * Create a SecondLayer React configuration
 */
export function createSecondLayerConfig(
	config: SecondLayerReactConfig,
): SecondLayerReactConfig {
	return {
		network: config.network,
		apiKey: config.apiKey,
		apiUrl: config.apiUrl,
		senderAddress: config.senderAddress || DEFAULT_SENDER_ADDRESS,
	};
}
