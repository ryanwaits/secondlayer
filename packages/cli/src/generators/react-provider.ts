import { format } from "prettier";

/**
 * Generate React provider template for user projects
 */
export async function generateReactProvider(): Promise<string> {
  const code = `import React, { createContext, useContext, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Stacks configuration for React hooks
 */
export interface StacksConfig {
  network: 'mainnet' | 'testnet' | 'devnet'
  apiKey?: string
  apiUrl?: string
  senderAddress?: string
}

/**
 * React Context for Stacks configuration
 */
const StacksContext = createContext<StacksConfig | null>(null)

interface StacksProviderProps {
  config: StacksConfig
  children: ReactNode
}

/**
 * Provider for Stacks configuration
 */
export function StacksProvider({ config, children }: StacksProviderProps) {
  return (
    <StacksContext.Provider value={config}>
      {children}
    </StacksContext.Provider>
  )
}

interface StacksQueryProviderProps {
  config: StacksConfig
  children: ReactNode
  queryClient?: QueryClient
}

/**
 * Convenience provider that includes both Stacks config and TanStack Query
 */
export function StacksQueryProvider({ 
  config, 
  children, 
  queryClient 
}: StacksQueryProviderProps) {
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
      <StacksProvider config={config} children={children} />
    </QueryClientProvider>
  )
}

/**
 * Hook to access the Stacks configuration
 */
export function useStacksConfig(): StacksConfig {
  const context = useContext(StacksContext)
  
  if (!context) {
    throw new Error('useStacksConfig must be used within a StacksProvider or StacksQueryProvider')
  }
  
  return context
}

/**
 * Create a Stacks configuration
 */
export function createStacksConfig(config: StacksConfig): StacksConfig {
  return {
    network: config.network,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    senderAddress: config.senderAddress || 'SP000000000000000000002Q6VF78'
  }
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
