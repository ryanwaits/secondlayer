import type { SecondLayerReactConfig } from "./types";

/**
 * Hook to access the SecondLayer configuration
 * This will be generated in user projects that have React
 */
export function useSecondLayerConfig(): SecondLayerReactConfig {
  throw new Error(
    "useSecondLayerConfig is only available in generated React hooks. Make sure you have React installed and hooks enabled in your config."
  );
}
