import type { StacksReactConfig } from "./types";

/**
 * Hook to access the Stacks configuration
 * This will be generated in user projects that have React
 */
export function useStacksConfig(): StacksReactConfig {
  throw new Error(
    "useStacksConfig is only available in generated React hooks. Make sure you have React installed and hooks enabled in your config."
  );
}
