/**
 * Contract-specific hooks generator for React plugin
 */

import type { ProcessedContract } from "../../../types/plugin";
import { formatCode } from "../../../utils/format";
import type { ClarityFunction } from "@secondlayer/clarity-types";
import {
  toCamelCase,
  capitalize,
  generateHookArgsSignature,
  generateArgsType,
  generateQueryKeyArgs,
  generateFunctionCallArgs,
  generateEnabledCondition,
  generateObjectArgs,
  clarityTypeToTS,
} from "./utils";
import type { ClarityMap, ClarityVariable } from "@secondlayer/clarity-types";

export async function generateContractHooks(
  contracts: ProcessedContract[],
  excludeList: string[] = []
): Promise<string> {
  const imports = `import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useSecondLayerConfig } from './provider'
import { request, openContractCall as stacksOpenContractCall } from '@stacks/connect'
import type { PostCondition } from '@stacks/transactions'
import { ${contracts.map((c) => c.name).join(", ")} } from './contracts'`;

  const header = `/**
 * Generated contract-specific React hooks
 * DO NOT EDIT MANUALLY
 */`;

  const hooksCode = contracts
    .map((contract) => generateContractHookMethods(contract, excludeList))
    .filter(Boolean)
    .join("\n\n");

  const code = `${imports}\n\n${header}\n\n${hooksCode}`;

  return formatCode(code);
}

function generateContractHookMethods(
  contract: ProcessedContract,
  excludeList: string[]
): string {
  const { abi, name, address, contractName } = contract;
  const functions = abi.functions || [];
  const maps = (abi.maps || []) as ClarityMap[];
  const variables = (abi.variables || []) as ClarityVariable[];

  const readOnlyFunctions = functions.filter(
    (f: ClarityFunction) =>
      f.access === "read-only"
  );
  const publicFunctions = functions.filter(
    (f: ClarityFunction) => f.access === "public"
  );

  const readHooks = readOnlyFunctions
    .map((func: ClarityFunction) => {
      const hookName = `use${capitalize(name)}${capitalize(toCamelCase(func.name))}`;
      // Check if this specific hook is excluded
      if (excludeList.includes(hookName)) {
        return null;
      }
      return generateReadHook(func, name);
    })
    .filter(Boolean);

  const writeHooks = publicFunctions
    .map((func: ClarityFunction) => {
      const hookName = `use${capitalize(name)}${capitalize(toCamelCase(func.name))}`;
      // Check if this specific hook is excluded
      if (excludeList.includes(hookName)) {
        return null;
      }
      return generateWriteHook(func, name);
    })
    .filter(Boolean);

  // Generate hooks for maps
  const mapHooks = maps
    .map((map: ClarityMap) => {
      const hookName = `use${capitalize(name)}${capitalize(toCamelCase(map.name))}`;
      if (excludeList.includes(hookName)) {
        return null;
      }
      return generateMapHook(map, name, address, contractName);
    })
    .filter(Boolean);

  // Generate hooks for data variables
  const dataVars = variables.filter((v) => v.access === "variable");
  const varHooks = dataVars
    .map((variable: ClarityVariable) => {
      const hookName = `use${capitalize(name)}${capitalize(toCamelCase(variable.name))}`;
      if (excludeList.includes(hookName)) {
        return null;
      }
      return generateVarHook(variable, name, address, contractName);
    })
    .filter(Boolean);

  // Generate hooks for constants
  const constants = variables.filter((v) => v.access === "constant");
  const constantHooks = constants
    .map((constant: ClarityVariable) => {
      const hookName = `use${capitalize(name)}${capitalize(toCamelCase(constant.name))}`;
      if (excludeList.includes(hookName)) {
        return null;
      }
      return generateConstantHook(constant, name, address, contractName);
    })
    .filter(Boolean);

  const allHooks = [...readHooks, ...writeHooks, ...mapHooks, ...varHooks, ...constantHooks];

  // If all hooks for this contract are excluded, return empty string
  if (allHooks.length === 0) {
    return "";
  }

  return allHooks.join("\n\n");
}

function generateReadHook(func: ClarityFunction, contractName: string): string {
  const hookName = `use${capitalize(contractName)}${capitalize(toCamelCase(func.name))}`;
  const argsSignature = generateHookArgsSignature(func.args);
  const enabledParam =
    func.args.length > 0
      ? ", options?: { enabled?: boolean }"
      : "options?: { enabled?: boolean }";

  // Generate proper return type from function outputs
  const returnType = clarityTypeToTS(func.outputs);

  return `export function ${hookName}(${argsSignature}${enabledParam}) {
  const config = useSecondLayerConfig()

  return useQuery<${returnType}>({
    queryKey: ['${func.name}', ${contractName}.address, ${generateQueryKeyArgs(func.args)}],
    queryFn: () => ${contractName}.read.${toCamelCase(func.name)}(${generateFunctionCallArgs(func.args) ? `{ ${generateObjectArgs(func.args)} }, ` : ""}{
      network: config.network,
      senderAddress: config.senderAddress || 'SP000000000000000000002Q6VF78'
    }),
    ${func.args.length > 0 ? `enabled: ${generateEnabledCondition(func.args)} && (options?.enabled ?? true),` : ""}
    ...options
  })
}`;
}

function generateWriteHook(
  func: ClarityFunction,
  contractName: string
): string {
  const hookName = `use${capitalize(contractName)}${capitalize(toCamelCase(func.name))}`;
  const argsType = generateArgsType(func.args);

  return `export function ${hookName}() {
  const config = useSecondLayerConfig()
  const queryClient = useQueryClient()
  
  const mutation = useMutation({
    mutationFn: async (params: {
      args: ${argsType};
      options?: {
        postConditions?: PostCondition[];
        attachment?: string;
        onFinish?: (data: any) => void;
        onCancel?: () => void;
      };
    }) => {
      const { args, options = {} } = params
      const contractCallData = ${contractName}.${toCamelCase(func.name)}(args)
      const { contractAddress, contractName: name, functionName, functionArgs } = contractCallData
      const network = config.network || 'mainnet'
      const contract = \`\${contractAddress}.\${name}\`
      
      // Try @stacks/connect v8 stx_callContract first (SIP-030)
      try {
        const result = await request('stx_callContract', {
          contract,
          functionName,
          functionArgs,
          network,
          ...options
        })
        
        options.onFinish?.(result)
        return result
      } catch (connectError) {
        // Fallback to openContractCall for broader wallet compatibility
        console.warn('stx_callContract not supported, falling back to openContractCall:', connectError)
        
        return new Promise((resolve, reject) => {
          stacksOpenContractCall({
            contractAddress,
            contractName: name,
            functionName,
            functionArgs,
            network,
            ...options,
            onFinish: (data: any) => {
              options.onFinish?.(data)
              resolve(data)
            },
            onCancel: () => {
              options.onCancel?.()
              reject(new Error('User cancelled transaction'))
            }
          })
        })
      }
    },
    onSuccess: () => {
      // Invalidate relevant queries on success
      queryClient.invalidateQueries({ queryKey: ['stacks-account'] })
    },
    onError: (error) => {
      console.error('Contract call failed:', error)
    }
  })

  const ${toCamelCase(func.name)} = useCallback(async (
    args: ${argsType},
    options?: {
      postConditions?: PostCondition[];
      attachment?: string;
      onFinish?: (data: any) => void;
      onCancel?: () => void;
    }
  ) => {
    return mutation.mutateAsync({ args, options })
  }, [mutation])

  return {
    ${toCamelCase(func.name)},
    // Expose mutation state
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset
  }
}`;
}

/**
 * Generate a hook for reading a map entry
 */
function generateMapHook(
  map: ClarityMap,
  contractVarName: string,
  _address: string,
  _contractName: string
): string {
  const hookName = `use${capitalize(contractVarName)}${capitalize(toCamelCase(map.name))}`;
  const keyType = clarityTypeToTS(map.key);
  const valueType = clarityTypeToTS(map.value);

  return `export function ${hookName}(key: ${keyType}, options?: { enabled?: boolean }) {
  const config = useSecondLayerConfig()

  return useQuery<${valueType} | null>({
    queryKey: ['${contractVarName}', '${map.name}', 'map', key, config.network],
    queryFn: async () => {
      return ${contractVarName}.maps.${toCamelCase(map.name)}.get(key, { network: config.network })
    },
    enabled: options?.enabled ?? true
  })
}`;
}

/**
 * Generate a hook for reading a data variable
 */
function generateVarHook(
  variable: ClarityVariable,
  contractVarName: string,
  _address: string,
  _contractName: string
): string {
  const hookName = `use${capitalize(contractVarName)}${capitalize(toCamelCase(variable.name))}`;
  const valueType = clarityTypeToTS(variable.type);

  return `export function ${hookName}(options?: { enabled?: boolean }) {
  const config = useSecondLayerConfig()

  return useQuery<${valueType}>({
    queryKey: ['${contractVarName}', '${variable.name}', 'var', config.network],
    queryFn: async () => {
      return ${contractVarName}.vars.${toCamelCase(variable.name)}.get({ network: config.network })
    },
    enabled: options?.enabled ?? true
  })
}`;
}

/**
 * Generate a hook for reading a constant
 */
function generateConstantHook(
  constant: ClarityVariable,
  contractVarName: string,
  _address: string,
  _contractName: string
): string {
  const hookName = `use${capitalize(contractVarName)}${capitalize(toCamelCase(constant.name))}`;
  const valueType = clarityTypeToTS(constant.type);

  return `export function ${hookName}(options?: { enabled?: boolean }) {
  const config = useSecondLayerConfig()

  return useQuery<${valueType}>({
    queryKey: ['${contractVarName}', '${constant.name}', 'constant', config.network],
    queryFn: async () => {
      return ${contractVarName}.constants.${toCamelCase(constant.name)}.get({ network: config.network })
    },
    enabled: options?.enabled ?? true,
    staleTime: Infinity // Constants never change
  })
}`;
}
