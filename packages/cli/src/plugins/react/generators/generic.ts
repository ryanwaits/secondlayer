/**
 * Generic Stacks hooks generator for React plugin
 */

import { formatCode } from "../../../utils/format";
import { USE_CONTRACT_TEMPLATE } from "../../../generators/templates/use-contract";

const GENERIC_HOOKS = [
  "useAccount",
  "useConnect",
  "useDisconnect",
  "useNetwork",
  "useContract",
  "useOpenSTXTransfer",
  "useSignMessage",
  "useDeployContract",
  "useReadContract",
  "useTransaction",
  "useBlock",
  "useAccountTransactions",
  "useWaitForTransaction",
] as const;

export async function generateGenericHooks(
  excludeList: string[] = []
): Promise<string> {
  // Filter out excluded hooks
  const hooksToGenerate = GENERIC_HOOKS.filter(
    (hookName) => !excludeList.includes(hookName)
  );

  const imports = `import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback } from 'react'
import { useSecondLayerConfig } from './provider'
import { connect, disconnect, isConnected, request } from '@secondlayer/stacks/connect'
import { Cl, validateStacksAddress } from '@secondlayer/stacks'
import type { PostCondition } from '@secondlayer/stacks'
import type { ExtractFunctionArgs, ExtractFunctionNames, AbiContract } from '@secondlayer/stacks/clarity'

const API_URLS: Record<string, string> = {
  mainnet: 'https://api.hiro.so',
  testnet: 'https://api.testnet.hiro.so',
  devnet: 'http://localhost:3999'
}

async function fetchTransaction({ txId, network, apiUrl }: { txId: string; network?: string; apiUrl?: string }): Promise<any> {
  const baseUrl = apiUrl || API_URLS[network || 'mainnet']
  const response = await fetch(\`\${baseUrl}/extended/v1/tx/\${txId}\`)
  if (!response.ok) throw new Error(\`Failed to fetch transaction: \${response.statusText}\`)
  return response.json()
}

async function fetchBlock({ height, network, apiUrl }: { height: number; network?: string; apiUrl?: string }): Promise<any> {
  const baseUrl = apiUrl || API_URLS[network || 'mainnet']
  const response = await fetch(\`\${baseUrl}/extended/v1/block/by_height/\${height}\`)
  if (!response.ok) throw new Error(\`Failed to fetch block: \${response.statusText}\`)
  return response.json()
}

async function fetchAccountTransactions({ address, network, apiUrl }: { address: string; network?: string; apiUrl?: string }): Promise<any> {
  const baseUrl = apiUrl || API_URLS[network || 'mainnet']
  const response = await fetch(\`\${baseUrl}/extended/v1/address/\${address}/transactions\`)
  if (!response.ok) throw new Error(\`Failed to fetch transactions: \${response.statusText}\`)
  return response.json()
}`;

  const header = `/**
 * Generated generic Stacks React hooks
 * DO NOT EDIT MANUALLY
 */`;

  const hooksCode = hooksToGenerate
    .map((hookName) => generateGenericHook(hookName))
    .filter(Boolean)
    .join("\n\n");

  const code = `${imports}\n\n${header}\n\n${hooksCode}`;

  return formatCode(code);
}

function generateGenericHook(hookName: string): string {
  switch (hookName) {
    case "useAccount":
      return `export function useAccount() {
  const config = useSecondLayerConfig()
  
  return useQuery({
    queryKey: ['stacks-account', config.network],
    queryFn: async () => {
      try {
        // Check if already connected
        const connected = isConnected()
        
        if (!connected) {
          return {
            address: undefined,
            addresses: undefined,
            isConnected: false,
            isConnecting: false,
            isDisconnected: true,
            status: 'disconnected' as const
          }
        }

        // Get addresses via SIP-030
        const result = await request('stx_getAddresses')
        
        if (!result || !result.addresses || result.addresses.length === 0) {
          return {
            address: undefined,
            addresses: undefined,
            isConnected: false,
            isConnecting: false,
            isDisconnected: true,
            status: 'disconnected' as const
          }
        }

        // Extract STX addresses from the response
        const stxAddresses = result.addresses
          .filter((addr: any) => addr.address.startsWith('SP') || addr.address.startsWith('ST'))
          .map((addr: any) => addr.address)

        return {
          address: stxAddresses[0] || undefined,
          addresses: stxAddresses,
          isConnected: true,
          isConnecting: false,
          isDisconnected: false,
          status: 'connected' as const
        }
      } catch (error) {
        // Handle case where wallet is not available or user rejected
        return {
          address: undefined,
          addresses: undefined,
          isConnected: false,
          isConnecting: false,
          isDisconnected: true,
          status: 'disconnected' as const
        }
      }
    },
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchInterval: 1000 * 30, // Refetch every 30 seconds to detect wallet changes
  })
}`;

    case "useConnect":
      return `export function useConnect() {
  const queryClient = useQueryClient()
  
  const mutation = useMutation({
    mutationFn: async (options: { forceWalletSelect?: boolean } = {}) => {
      // SIP-030 connect
      return await connect(options)
    },
    onSuccess: () => {
      // Invalidate account queries to refetch connection state
      queryClient.invalidateQueries({ queryKey: ['stacks-account'] })
    },
    onError: (error) => {
      console.error('Connection failed:', error)
    }
  })

  return {
    // Custom connect function that works without arguments
    connect: (options?: { forceWalletSelect?: boolean }) => {
      return mutation.mutate(options || {})
    },
    connectAsync: async (options?: { forceWalletSelect?: boolean }) => {
      return mutation.mutateAsync(options || {})
    },
    // Expose all the mutation state
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
    // Keep the original mutate/mutateAsync for advanced users
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync
  }
}`;

    case "useDisconnect":
      return `export function useDisconnect() {
  const queryClient = useQueryClient()
  
  const mutation = useMutation({
    mutationFn: async () => {
      // SIP-030 disconnect
      return await disconnect()
    },
    onSuccess: () => {
      // Clear all cached data on disconnect
      queryClient.clear()
    },
    onError: (error) => {
      console.error('Disconnect failed:', error)
    }
  })

  return {
    // Custom disconnect function
    disconnect: () => {
      return mutation.mutate()
    },
    disconnectAsync: async () => {
      return mutation.mutateAsync()
    },
    // Expose all the mutation state
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
    // Keep the original mutate/mutateAsync for advanced users
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync
  }
}`;

    case "useNetwork":
      return `export function useNetwork() {
  const config = useSecondLayerConfig()
  
  return useQuery({
    queryKey: ['stacks-network', config.network],
    queryFn: async () => {
      // Currently read-only from config
      // Future: Use request('stx_getNetworks') when wallet support improves
      const network = config.network
      
      return {
        network,
        isMainnet: network === 'mainnet',
        isTestnet: network === 'testnet', 
        isDevnet: network === 'devnet',
        // Future: Add switchNetwork when wallets support stx_networkChange
        // switchNetwork: async (newNetwork: string) => {
        //   return await request('wallet_changeNetwork', { network: newNetwork })
        // }
      }
    },
    staleTime: Infinity, // Network config rarely changes
    refetchOnWindowFocus: false,
    retry: false
  })
}`;

    case "useContract":
      return USE_CONTRACT_TEMPLATE;

    case "useReadContract":
      return `export function useReadContract<TArgs = any, TResult = any>(params: {
  contractAddress: string;
  contractName: string;
  functionName: string;
  args?: TArgs;
  network?: 'mainnet' | 'testnet' | 'devnet';
  enabled?: boolean;
}) {
  const config = useSecondLayerConfig()
  
  return useQuery<TResult>({
    queryKey: ['read-contract', params.contractAddress, params.contractName, params.functionName, params.args, params.network || config.network],
    queryFn: async () => {
      const { fetchCallReadOnlyFunction } = await import('@secondlayer/stacks/clarity')
      
      // For now, we'll need to handle the args conversion here
      // In the future, we could integrate with the contract interface for automatic conversion
      let functionArgs: any[] = []
      
      if (params.args) {
        // This is a simplified conversion - in practice, we'd need the ABI to do proper conversion
        // For now, we'll assume the args are already in the correct format or simple types
        if (Array.isArray(params.args)) {
          functionArgs = params.args
        } else if (typeof params.args === 'object') {
          // Convert object args to array (this is a basic implementation)
          functionArgs = Object.values(params.args)
        } else {
          functionArgs = [params.args]
        }
      }
      
      return await fetchCallReadOnlyFunction({
        contractAddress: params.contractAddress,
        contractName: params.contractName,
        functionName: params.functionName,
        functionArgs,
        network: params.network || config.network || 'mainnet',
        senderAddress: config.senderAddress || 'SP000000000000000000002Q6VF78'
      }) as TResult
    },
    enabled: params.enabled ?? true
  })
}`;

    case "useTransaction":
      return `export function useTransaction(txId?: string) {
  const config = useSecondLayerConfig()
  
  return useQuery({
    queryKey: ['transaction', txId, config.network],
    queryFn: () => fetchTransaction({
      txId: txId!,
      network: config.network,
      apiUrl: config.apiUrl
    }),
    enabled: !!txId
  })
}`;

    case "useBlock":
      return `export function useBlock(height?: number) {
  const config = useSecondLayerConfig()
  
  return useQuery({
    queryKey: ['block', height, config.network],
    queryFn: () => fetchBlock({
      height: height!,
      network: config.network,
      apiUrl: config.apiUrl
    }),
    enabled: typeof height === 'number'
  })
}`;

    case "useAccountTransactions":
      return `export function useAccountTransactions(address?: string) {
  const config = useSecondLayerConfig()
  
  return useQuery({
    queryKey: ['account-transactions', address, config.network],
    queryFn: () => fetchAccountTransactions({
      address: address!,
      network: config.network,
      apiUrl: config.apiUrl
    }),
    enabled: !!address
  })
}`;

    case "useWaitForTransaction":
      return `export function useWaitForTransaction(txId?: string) {
  const config = useSecondLayerConfig()
  
  return useQuery({
    queryKey: ['wait-for-transaction', txId, config.network],
    queryFn: () => fetchTransaction({
      txId: txId!,
      network: config.network,
      apiUrl: config.apiUrl
    }),
    enabled: !!txId,
    refetchInterval: (data) => {
      // Stop polling when transaction is complete
      if (data?.tx_status === 'success' || 
          data?.tx_status === 'abort_by_response' || 
          data?.tx_status === 'abort_by_post_condition') {
        return false
      }
      return 2000 // Poll every 2 seconds
    },
    staleTime: 0 // Always refetch
  })
}`;

    case "useOpenSTXTransfer":
      return `export function useOpenSTXTransfer() {
  const config = useSecondLayerConfig()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (params: {
      recipient: string;
      amount: string | number;
      memo?: string;
      network?: string;
    }) => {
      const { recipient, amount, memo } = params
      const network = params.network || config.network || 'mainnet'

      return await request('stx_transferStx', {
        recipient,
        amount: amount.toString(),
        memo,
        network,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks-account'] })
    },
    onError: (error) => {
      console.error('STX transfer failed:', error)
    }
  })

  const openSTXTransfer = useCallback(async (params: {
    recipient: string;
    amount: string | number;
    memo?: string;
    network?: string;
  }) => {
    return mutation.mutateAsync(params)
  }, [mutation])

  return {
    openSTXTransfer,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset
  }
}`;

    case "useSignMessage":
      return `export function useSignMessage() {
  const config = useSecondLayerConfig()

  const mutation = useMutation({
    mutationFn: async (params: {
      message: string;
      network?: string;
    }) => {
      const { message } = params
      const network = params.network || config.network || 'mainnet'

      return await request('stx_signMessage', {
        message,
        network,
      })
    },
    onError: (error) => {
      console.error('Message signing failed:', error)
    }
  })

  const signMessage = useCallback(async (params: {
    message: string;
    network?: string;
  }) => {
    return mutation.mutateAsync(params)
  }, [mutation])

  return {
    signMessage,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset
  }
}`;

    case "useDeployContract":
      return `export function useDeployContract() {
  const config = useSecondLayerConfig()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (params: {
      contractName: string;
      codeBody: string;
      network?: string;
    }) => {
      const { contractName, codeBody } = params
      const network = params.network || config.network || 'mainnet'

      return await request('stx_deployContract', {
        name: contractName,
        clarityCode: codeBody,
        network,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks-account'] })
    },
    onError: (error) => {
      console.error('Contract deployment failed:', error)
    }
  })

  const deployContract = useCallback(async (params: {
    contractName: string;
    codeBody: string;
    network?: string;
  }) => {
    return mutation.mutateAsync(params)
  }, [mutation])

  return {
    deployContract,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset
  }
}`;

    default:
      return "";
  }
}
