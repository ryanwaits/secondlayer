/**
 * React Provider for Stacks configuration
 */

import React from "react";
import { StacksContext } from "./context";
import type { StacksProviderProps, StacksReactConfig } from "../types";

/**
 * Create a Stacks React configuration with defaults
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

/**
 * Provider component that makes Stacks configuration available to hooks
 */
export function StacksProvider({ children, config }: StacksProviderProps) {
  const resolvedConfig = createStacksConfig(config);

  return (
    <StacksContext.Provider value={resolvedConfig}>
      {children}
    </StacksContext.Provider>
  );
}

/**
 * Hook to access the Stacks configuration
 */
export function useStacksConfig(): StacksReactConfig {
  const context = React.useContext(StacksContext);

  if (context === undefined) {
    throw new Error(
      "useStacksConfig must be used within a StacksProvider. " +
        "Make sure to wrap your app with <StacksProvider config={...}>"
    );
  }

  return context;
}
