import { formatCode } from "../utils/format";

/**
 * Generate React provider template for user projects
 */
export async function generateReactProvider(): Promise<string> {
  const code = `import React, { createContext, useContext, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * SecondLayer configuration for React hooks
 */
export interface SecondLayerConfig {
  network: 'mainnet' | 'testnet' | 'devnet'
  apiKey?: string
  apiUrl?: string
  senderAddress?: string
}

/**
 * React Context for SecondLayer configuration
 */
const SecondLayerContext = createContext<SecondLayerConfig | null>(null)

interface SecondLayerProviderProps {
  config: SecondLayerConfig
  children: ReactNode
}

/**
 * Provider for SecondLayer configuration
 */
export function SecondLayerProvider({ config, children }: SecondLayerProviderProps) {
  return (
    <SecondLayerContext.Provider value={config}>
      {children}
    </SecondLayerContext.Provider>
  )
}

interface SecondLayerQueryProviderProps {
  config: SecondLayerConfig
  children: ReactNode
  queryClient?: QueryClient
}

/**
 * Convenience provider that includes both SecondLayer config and TanStack Query
 */
export function SecondLayerQueryProvider({
  config,
  children,
  queryClient
}: SecondLayerQueryProviderProps) {
  const client = queryClient || new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: 3,
        retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
      },
      mutations: {
        retry: 1,
      },
    },
  })

  return (
    <QueryClientProvider client={client}>
      <SecondLayerProvider config={config} children={children} />
    </QueryClientProvider>
  )
}

/**
 * Hook to access the SecondLayer configuration
 */
export function useSecondLayerConfig(): SecondLayerConfig {
  const context = useContext(SecondLayerContext)

  if (!context) {
    throw new Error('useSecondLayerConfig must be used within a SecondLayerProvider or SecondLayerQueryProvider')
  }

  return context
}

/**
 * Create a SecondLayer configuration
 */
export function createSecondLayerConfig(config: SecondLayerConfig): SecondLayerConfig {
  return {
    network: config.network,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    senderAddress: config.senderAddress || 'SP000000000000000000002Q6VF78'
  }
}`;

  return formatCode(code);
}
