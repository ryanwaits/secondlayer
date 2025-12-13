/**
 * Stacks API utility functions
 * Implements missing API functions using Stacks blockchain endpoints
 * DO NOT EDIT MANUALLY
 */

export interface StacksNetwork {
  network: 'mainnet' | 'testnet' | 'devnet'
  apiUrl?: string
}

/**
 * Get the API base URL for the given network
 */
function getApiUrl(network: StacksNetwork): string {
  if (network.apiUrl) {
    return network.apiUrl
  }

  switch (network.network) {
    case 'mainnet':
      return 'https://api.hiro.so'
    case 'testnet':
      return 'https://api.testnet.hiro.so'
    case 'devnet':
      return 'http://localhost:3999'
    default:
      return 'https://api.testnet.hiro.so'
  }
}

/**
 * Get the RPC API base URL for the given network
 */
function getRpcApiUrl(network: StacksNetwork): string {
  switch (network.network) {
    case 'mainnet':
      return 'https://stacks-node-api.mainnet.stacks.co'
    case 'testnet':
      return 'https://stacks-node-api.testnet.stacks.co'
    case 'devnet':
      return 'http://localhost:20443'
    default:
      return 'https://stacks-node-api.testnet.stacks.co'
  }
}

/**
 * Fetch account information
 */
export async function fetchAccountInfo({
  address,
  network,
  apiUrl,
}: {
  address: string
  network: 'mainnet' | 'testnet' | 'devnet'
  apiUrl?: string
}) {
  const networkConfig: StacksNetwork = { network, apiUrl }
  const rpcUrl = getRpcApiUrl(networkConfig)

  try {
    // Try RPC API first (more decentralized)
    const response = await fetch(`${rpcUrl}/v2/accounts/${address}`)
    if (!response.ok) {
      throw new Error(`RPC API failed: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    // Fallback to Hiro API
    const apiUrlFallback = getApiUrl(networkConfig)
    const response = await fetch(`${apiUrlFallback}/extended/v1/address/${address}/balances`)
    if (!response.ok) {
      throw new Error(`Failed to fetch account info: ${response.status}`)
    }
    return await response.json()
  }
}

/**
 * Fetch transaction information
 */
export async function fetchTransaction({
  txId,
  network,
  apiUrl,
}: {
  txId: string
  network: 'mainnet' | 'testnet' | 'devnet'
  apiUrl?: string
}) {
  const networkConfig: StacksNetwork = { network, apiUrl }
  const apiUrlResolved = getApiUrl(networkConfig)

  const response = await fetch(`${apiUrlResolved}/extended/v1/tx/${txId}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch transaction: ${response.status}`)
  }
  return await response.json()
}

/**
 * Fetch block information
 */
export async function fetchBlock({
  height,
  network,
  apiUrl,
}: {
  height: number
  network: 'mainnet' | 'testnet' | 'devnet'
  apiUrl?: string
}) {
  const networkConfig: StacksNetwork = { network, apiUrl }
  const apiUrlResolved = getApiUrl(networkConfig)

  const response = await fetch(`${apiUrlResolved}/extended/v1/block/by_height/${height}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch block: ${response.status}`)
  }
  return await response.json()
}

/**
 * Fetch account transactions
 */
export async function fetchAccountTransactions({
  address,
  network,
  apiUrl,
  limit = 50,
  offset = 0,
}: {
  address: string
  network: 'mainnet' | 'testnet' | 'devnet'
  apiUrl?: string
  limit?: number
  offset?: number
}) {
  const networkConfig: StacksNetwork = { network, apiUrl }
  const apiUrlResolved = getApiUrl(networkConfig)

  const response = await fetch(
    `${apiUrlResolved}/extended/v1/address/${address}/transactions?limit=${limit}&offset=${offset}`
  )
  if (!response.ok) {
    throw new Error(`Failed to fetch account transactions: ${response.status}`)
  }
  return await response.json()
}
