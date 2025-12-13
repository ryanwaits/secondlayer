/**
 * Generic Stacks hooks generator for React plugin
 */

import { format } from "prettier";

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
import { useStacksConfig } from './provider'
import { connect, disconnect, isConnected, request, openContractCall as stacksOpenContractCall } from '@stacks/connect'
import { Cl, validateStacksAddress } from '@stacks/transactions'
import type { ExtractFunctionArgs, ExtractFunctionNames, ClarityContract } from '@secondlayer/clarity-types'`;

  const header = `/**
 * Generated generic Stacks React hooks
 * DO NOT EDIT MANUALLY
 */`;

  const hooksCode = hooksToGenerate
    .map((hookName) => generateGenericHook(hookName))
    .filter(Boolean)
    .join("\n\n");

  const code = `${imports}\n\n${header}\n\n${hooksCode}`;

  const formatted = await format(code, {
    parser: "typescript",
    singleQuote: true,
    semi: false,
    printWidth: 100,
    trailingComma: "es5",
  });

  return formatted;
}

function generateGenericHook(hookName: string): string {
  switch (hookName) {
    case "useAccount":
      return `export function useAccount() {
  const config = useStacksConfig()
  
  return useQuery({
    queryKey: ['stacks-account', config.network],
    queryFn: async () => {
      try {
        // Check if already connected using @stacks/connect v8
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

        // Get addresses using @stacks/connect v8 request method (SIP-030)
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
      // Use @stacks/connect v8 connect method
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
      // Use @stacks/connect v8 disconnect method
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
  const config = useStacksConfig()
  
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
      return `export function useContract() {
  const config = useStacksConfig()
  const queryClient = useQueryClient()
  const [isRequestPending, setIsRequestPending] = useState(false)
  
  // Helper function to convert JS values to Clarity values based on ABI
  const convertArgsWithAbi = (args: any, abiArgs: any[]): any[] => {
    if (!abiArgs || abiArgs.length === 0) return []
    
    return abiArgs.map((abiArg, index) => {
      const argValue = Array.isArray(args) 
        ? args[index] 
        : args[abiArg.name] || args[abiArg.name.replace(/-/g, '').replace(/_/g, '')]
      return convertJSValueToClarityValue(argValue, abiArg.type)
    })
  }

  // Helper function to convert buffer values with auto-detection
  const convertBufferValue = (value: any): any => {
    // Direct Uint8Array
    if (value instanceof Uint8Array) {
      return Cl.buffer(value)
    }
    
    // Object notation with explicit type
    if (typeof value === 'object' && value !== null && value.type && value.value) {
      switch (value.type) {
        case 'ascii':
          return Cl.bufferFromAscii(value.value)
        case 'utf8':
          return Cl.bufferFromUtf8(value.value)
        case 'hex':
          return Cl.bufferFromHex(value.value)
        default:
          throw new Error(\`Unsupported buffer type: \${value.type}\`)
      }
    }
    
    // Auto-detect string type
    if (typeof value === 'string') {
      // 1. Check for hex (0x prefix or pure hex pattern)
      if (value.startsWith('0x') || /^[0-9a-fA-F]+$/.test(value)) {
        return Cl.bufferFromHex(value)
      }
      
      // 2. Check for non-ASCII characters (UTF-8)
      if (!/^[\\x00-\\x7F]*$/.test(value)) {
        return Cl.bufferFromUtf8(value)
      }
      
      // 3. Default to ASCII for simple ASCII strings
      return Cl.bufferFromAscii(value)
    }
    
    throw new Error(\`Invalid buffer value: \${value}\`)
  }

  // Helper function to convert a single JS value to ClarityValue
  const convertJSValueToClarityValue = (value: any, type: any): any => {
    if (typeof type === 'string') {
      switch (type) {
        case 'uint128':
          return Cl.uint(value)
        case 'int128':
          return Cl.int(value)
        case 'bool':
          return Cl.bool(value)
        case 'principal':
          if (!validateStacksAddress(value.split('.')[0])) {
            throw new Error('Invalid Stacks address format')
          }
          if (value.includes('.')) {
            const [address, contractName] = value.split('.')
            return Cl.contractPrincipal(address, contractName)
          } else {
            return Cl.standardPrincipal(value)
          }
        default:
          return value
      }
    }

    if (type['string-ascii']) {
      return Cl.stringAscii(value)
    }

    if (type['string-utf8']) {
      return Cl.stringUtf8(value)
    }

    if (type.buff) {
      return convertBufferValue(value)
    }

    if (type.optional) {
      return value !== null ? Cl.some(convertJSValueToClarityValue(value, type.optional)) : Cl.none()
    }

    if (type.list) {
      return Cl.list(value.map((item: any) => convertJSValueToClarityValue(item, type.list.type)))
    }

    if (type.tuple) {
      const tupleData = type.tuple.reduce((acc: any, field: any) => {
        acc[field.name] = convertJSValueToClarityValue(value[field.name], field.type)
        return acc
      }, {})
      return Cl.tuple(tupleData)
    }

    if (type.response) {
      return 'ok' in value 
        ? Cl.ok(convertJSValueToClarityValue(value.ok, type.response.ok))
        : Cl.error(convertJSValueToClarityValue(value.err, type.response.error))
    }

    return value
  }

  // Helper function to find a function in an ABI by name
  const findFunctionInAbi = (abi: any, functionName: string): any => {
    if (!abi || !abi.functions) return null
    return abi.functions.find((func: any) => func.name === functionName)
  }
  
  // Legacy function - unchanged, backward compatible
  const legacyOpenContractCall = useCallback(async (params: {
    contractAddress: string;
    contractName: string;
    functionName: string;
    functionArgs: any[]; // Pre-converted Clarity values
    network?: string;
    postConditions?: any[];
    attachment?: string;
    onFinish?: (data: any) => void;
    onCancel?: () => void;
  }) => {
    setIsRequestPending(true)
    
    try {
      const { contractAddress, contractName, functionName, functionArgs, onFinish, onCancel, ...options } = params
      const network = params.network || config.network || 'mainnet'
      const contract = \`\${contractAddress}.\${contractName}\`
      
      // Try @stacks/connect v8 stx_callContract first (SIP-030)
      try {
        const result = await request('stx_callContract', {
          contract,
          functionName,
          functionArgs,
          network,
          ...options
        })
        
        // Invalidate relevant queries on success
        queryClient.invalidateQueries({ 
          queryKey: ['stacks-account'] 
        })
        
        onFinish?.(result)
        return result
      } catch (connectError) {
        // Fallback to openContractCall for broader wallet compatibility
        console.warn('stx_callContract not supported, falling back to openContractCall:', connectError)
        
        return new Promise((resolve, reject) => {
          stacksOpenContractCall({
            contractAddress,
            contractName,
            functionName,
            functionArgs,
            network,
            ...options,
            onFinish: (data: any) => {
              // Invalidate relevant queries on success
              queryClient.invalidateQueries({ 
                queryKey: ['stacks-account'] 
              })
              
              onFinish?.(data)
              resolve(data)
            },
            onCancel: () => {
              onCancel?.()
              reject(new Error('User cancelled transaction'))
            }
          })
        })
      }
    } catch (error) {
      console.error('Contract call failed:', error)
      throw error instanceof Error ? error : new Error('Contract call failed')
    } finally {
      setIsRequestPending(false)
    }
  }, [config.network, queryClient])

  // Enhanced function - requires ABI, auto-converts JS values
  const openContractCall = useCallback(async <
    T extends ClarityContract,
    FN extends ExtractFunctionNames<T>
  >(params: {
    contractAddress: string;
    contractName: string;
    functionName: FN;
    abi: T;
    functionArgs: ExtractFunctionArgs<T, FN>;
    network?: string;
    postConditions?: any[];
    attachment?: string;
    onFinish?: (data: any) => void;
    onCancel?: () => void;
  }) => {
    setIsRequestPending(true)
    
    try {
      const { contractAddress, contractName, functionName, functionArgs, abi, onFinish, onCancel, ...options } = params
      const network = params.network || config.network || 'mainnet'
      const contract = \`\${contractAddress}.\${contractName}\`
      
      // Find the function in the ABI and convert args
      const abiFunction = findFunctionInAbi(abi, functionName)
      if (!abiFunction) {
        throw new Error(\`Function '\${functionName}' not found in ABI\`)
      }
      
      const processedArgs = convertArgsWithAbi(functionArgs, abiFunction.args || [])
      
      // Try @stacks/connect v8 stx_callContract first (SIP-030)
      try {
        const result = await request('stx_callContract', {
          contract,
          functionName,
          functionArgs: processedArgs,
          network,
          ...options
        })
        
        // Invalidate relevant queries on success
        queryClient.invalidateQueries({ 
          queryKey: ['stacks-account'] 
        })
        
        onFinish?.(result)
        return result
      } catch (connectError) {
        // Fallback to openContractCall for broader wallet compatibility
        console.warn('stx_callContract not supported, falling back to openContractCall:', connectError)
        
        return new Promise((resolve, reject) => {
          stacksOpenContractCall({
            contractAddress,
            contractName,
            functionName,
            functionArgs: processedArgs,
            network,
            ...options,
            onFinish: (data: any) => {
              // Invalidate relevant queries on success
              queryClient.invalidateQueries({ 
                queryKey: ['stacks-account'] 
              })
              
              onFinish?.(data)
              resolve(data)
            },
            onCancel: () => {
              onCancel?.()
              reject(new Error('User cancelled transaction'))
            }
          })
        })
      }
    } catch (error) {
      console.error('Contract call failed:', error)
      throw error instanceof Error ? error : new Error('Contract call failed')
    } finally {
      setIsRequestPending(false)
    }
  }, [config.network, queryClient])

  return {
    legacyOpenContractCall,
    openContractCall,
    isRequestPending
  }
}`;

    case "useReadContract":
      return `export function useReadContract<TArgs = any, TResult = any>(params: {
  contractAddress: string;
  contractName: string;
  functionName: string;
  args?: TArgs;
  network?: 'mainnet' | 'testnet' | 'devnet';
  enabled?: boolean;
}) {
  const config = useStacksConfig()
  
  return useQuery<TResult>({
    queryKey: ['read-contract', params.contractAddress, params.contractName, params.functionName, params.args, params.network || config.network],
    queryFn: async () => {
      const { fetchCallReadOnlyFunction } = await import('@stacks/transactions')
      
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
  const config = useStacksConfig()
  
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
  const config = useStacksConfig()
  
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
  const config = useStacksConfig()
  
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
  const config = useStacksConfig()
  
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
  const config = useStacksConfig()
  const queryClient = useQueryClient()
  
  const mutation = useMutation({
    mutationFn: async (params: {
      recipient: string;
      amount: string | number;
      memo?: string;
      network?: string;
      onFinish?: (data: any) => void;
      onCancel?: () => void;
    }) => {
      const { recipient, amount, memo, onFinish, onCancel, ...options } = params
      const network = params.network || config.network || 'mainnet'
      
      return new Promise((resolve, reject) => {
        openSTXTransfer({
          recipient,
          amount: amount.toString(),
          memo,
          network,
          ...options,
          onFinish: (data: any) => {
            onFinish?.(data)
            resolve(data)
          },
          onCancel: () => {
            onCancel?.()
            reject(new Error('User cancelled transaction'))
          }
        })
      })
    },
    onSuccess: () => {
      // Invalidate relevant queries on success
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
    onFinish?: (data: any) => void;
    onCancel?: () => void;
  }) => {
    return mutation.mutateAsync(params)
  }, [mutation])

  return {
    openSTXTransfer,
    // Expose mutation state
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
  const config = useStacksConfig()
  
  const mutation = useMutation({
    mutationFn: async (params: {
      message: string;
      network?: string;
      onFinish?: (data: any) => void;
      onCancel?: () => void;
    }) => {
      const { message, onFinish, onCancel, ...options } = params
      const network = params.network || config.network || 'mainnet'
      
      return new Promise((resolve, reject) => {
        openSignatureRequestPopup({
          message,
          network,
          ...options,
          onFinish: (data: any) => {
            onFinish?.(data)
            resolve(data)
          },
          onCancel: () => {
            onCancel?.()
            reject(new Error('User cancelled message signing'))
          }
        })
      })
    },
    onError: (error) => {
      console.error('Message signing failed:', error)
    }
  })

  const signMessage = useCallback(async (params: {
    message: string;
    network?: string;
    onFinish?: (data: any) => void;
    onCancel?: () => void;
  }) => {
    return mutation.mutateAsync(params)
  }, [mutation])

  return {
    signMessage,
    // Expose mutation state
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
  const config = useStacksConfig()
  const queryClient = useQueryClient()
  
  const mutation = useMutation({
    mutationFn: async (params: {
      contractName: string;
      codeBody: string;
      network?: string;
      postConditions?: any[];
      onFinish?: (data: any) => void;
      onCancel?: () => void;
    }) => {
      const { contractName, codeBody, onFinish, onCancel, ...options } = params
      const network = params.network || config.network || 'mainnet'
      
      return new Promise((resolve, reject) => {
        openContractDeploy({
          contractName,
          codeBody,
          network,
          ...options,
          onFinish: (data: any) => {
            onFinish?.(data)
            resolve(data)
          },
          onCancel: () => {
            onCancel?.()
            reject(new Error('User cancelled contract deployment'))
          }
        })
      })
    },
    onSuccess: () => {
      // Invalidate relevant queries on success
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
    postConditions?: any[];
    onFinish?: (data: any) => void;
    onCancel?: () => void;
  }) => {
    return mutation.mutateAsync(params)
  }, [mutation])

  return {
    deployContract,
    // Expose mutation state
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
