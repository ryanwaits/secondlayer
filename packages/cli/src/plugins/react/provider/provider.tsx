/**
 * React Provider for SecondLayer configuration
 */

import React from "react";
import { SecondLayerContext } from "./context";
import type { SecondLayerProviderProps, SecondLayerReactConfig } from "../types";

/**
 * Create a SecondLayer React configuration with defaults
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

/**
 * Provider component that makes SecondLayer configuration available to hooks
 */
export function SecondLayerProvider({ children, config }: SecondLayerProviderProps) {
  const resolvedConfig = createSecondLayerConfig(config);

  return (
    <SecondLayerContext.Provider value={resolvedConfig}>
      {children}
    </SecondLayerContext.Provider>
  );
}

/**
 * Hook to access the SecondLayer configuration
 */
export function useSecondLayerConfig(): SecondLayerReactConfig {
  const context = React.useContext(SecondLayerContext);

  if (context === undefined) {
    throw new Error(
      "useSecondLayerConfig must be used within a SecondLayerProvider. " +
        "Make sure to wrap your app with <SecondLayerProvider config={...}>"
    );
  }

  return context;
}
