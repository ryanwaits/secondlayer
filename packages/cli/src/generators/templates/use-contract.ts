/**
 * Shared template for the useContract hook.
 * Used by both the base hooks generator and the react plugin generic generator.
 */

export const USE_CONTRACT_TEMPLATE = `export function useContract() {
  const config = useSecondLayerConfig()
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
    postConditions?: PostCondition[];
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
    postConditions?: PostCondition[];
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
