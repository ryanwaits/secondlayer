/**
 * Provider generator for React plugin
 */

import { format } from "prettier";

/**
 * Generate the provider file content for user projects
 */
export async function generateProvider(): Promise<string> {
  const code = `/**
 * Generated Stacks React Provider
 * DO NOT EDIT MANUALLY
 */

import React, { createContext, useContext } from 'react'

/**
 * Stacks configuration interface
 */
export interface StacksReactConfig {
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
export interface StacksProviderProps {
  children: React.ReactNode
  config: StacksReactConfig
}

/**
 * React context for Stacks configuration
 */
const StacksContext = createContext<StacksReactConfig | undefined>(undefined)
StacksContext.displayName = 'StacksContext'

/**
 * Create a Stacks React configuration with defaults
 */
export function createStacksConfig(config: StacksReactConfig): StacksReactConfig {
  return {
    network: config.network,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    senderAddress: config.senderAddress || 'SP000000000000000000002Q6VF78'
  }
}

/**
 * Provider component that makes Stacks configuration available to hooks
 */
export function StacksProvider({ children, config }: StacksProviderProps) {
  const resolvedConfig = createStacksConfig(config)

  return (
    <StacksContext.Provider value={resolvedConfig}>
      {children}
    </StacksContext.Provider>
  )
}

/**
 * Hook to access the Stacks configuration
 */
export function useStacksConfig(): StacksReactConfig {
  const context = useContext(StacksContext)
  
  if (context === undefined) {
    throw new Error(
      'useStacksConfig must be used within a StacksProvider. ' +
      'Make sure to wrap your app with <StacksProvider config={{...}}>'
    )
  }
  
  return context
}`;

  const formatted = await format(code, {
    parser: "typescript",
    singleQuote: true,
    semi: false,
    printWidth: 100,
    trailingComma: "es5",
  });

  return formatted;
}
