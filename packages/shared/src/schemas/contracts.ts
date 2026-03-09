export interface ContractSummary {
  contractId: string;
  name: string;
  deployer: string;
  deployBlock: number;
  callCount: number;
  lastCalledAt: string | null;
  createdAt: string;
}

export interface ContractDetail extends ContractSummary {
  deployTxId: string;
  abi: unknown | null;
  updatedAt: string;
}

export interface SearchContractsResponse {
  contracts: ContractSummary[];
  total: number;
}
