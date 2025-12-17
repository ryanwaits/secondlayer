/**
 * Provider generator for React plugin
 */

import { formatCode } from "../../../utils/format";

/**
 * Generate the provider file content for user projects
 */
export async function generateProvider(): Promise<string> {
  const code = `/**
 * Generated SecondLayer React Provider
 * DO NOT EDIT MANUALLY
 */

import React, { createContext, useContext } from 'react'

/**
 * SecondLayer configuration interface
 */
export interface SecondLayerReactConfig {
  /**
   * Network to use for API calls
   */
  network: 'mainnet' | 'testnet' | 'devnet'

  /**
   * API key for Stacks API (optional)
   */
  apiKey?: string

  /**
   * Base URL for Stacks API (optional override)
   */
  apiUrl?: string

  /**
   * Default sender address for read-only calls
   */
  senderAddress?: string
}

/**
 * Provider component props
 */
export interface SecondLayerProviderProps {
  children: React.ReactNode
  config: SecondLayerReactConfig
}

/**
 * React context for SecondLayer configuration
 */
const SecondLayerContext = createContext<SecondLayerReactConfig | undefined>(undefined)
SecondLayerContext.displayName = 'SecondLayerContext'

/**
 * Create a SecondLayer React configuration with defaults
 */
export function createSecondLayerConfig(config: SecondLayerReactConfig): SecondLayerReactConfig {
  return {
    network: config.network,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    senderAddress: config.senderAddress || 'SP000000000000000000002Q6VF78'
  }
}

/**
 * Provider component that makes SecondLayer configuration available to hooks
 */
export function SecondLayerProvider({ children, config }: SecondLayerProviderProps) {
  const resolvedConfig = createSecondLayerConfig(config)

  return (
    <SecondLayerContext.Provider value={resolvedConfig}>
      {children}
    </SecondLayerContext.Provider>
  )
}

/**
 * Hook to access the SecondLayer configuration
 */
export function useSecondLayerConfig(): SecondLayerReactConfig {
  const context = useContext(SecondLayerContext)

  if (context === undefined) {
    throw new Error(
      'useSecondLayerConfig must be used within a SecondLayerProvider. ' +
      'Make sure to wrap your app with <SecondLayerProvider config={{...}}>'
    )
  }

  return context
}`;

  return formatCode(code);
}
