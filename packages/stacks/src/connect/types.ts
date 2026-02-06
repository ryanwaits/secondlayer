export interface WalletProvider {
  request(method: string, params?: any): Promise<any>;
  disconnect?(): void;
}

export interface AddressEntry {
  symbol?: string;
  address: string;
  publicKey: string;
}

export interface AddressesResult {
  addresses: AddressEntry[];
}

export interface TransferStxParams {
  recipient: string;
  amount: string;
  memo?: string;
  network?: string;
}

export interface CallContractParams {
  contract: string;
  functionName: string;
  functionArgs: any[];
  network?: string;
  postConditions?: any[];
  attachment?: string;
}

export interface DeployContractParams {
  name: string;
  clarityCode: string;
  network?: string;
}

export interface SignMessageParams {
  message: string;
  network?: string;
}

export interface SignTransactionParams {
  transaction: string;
  network?: string;
}

export interface Methods {
  getAddresses: { params: undefined; result: AddressesResult };
  stx_getAddresses: { params: undefined; result: AddressesResult };
  stx_transferStx: { params: TransferStxParams; result: any };
  stx_callContract: { params: CallContractParams; result: any };
  stx_deployContract: { params: DeployContractParams; result: any };
  stx_signMessage: { params: SignMessageParams; result: any };
  stx_signTransaction: { params: SignTransactionParams; result: any };
}

export type MethodParams<M extends keyof Methods> = Methods[M]["params"];
export type MethodResult<M extends keyof Methods> = Methods[M]["result"];
