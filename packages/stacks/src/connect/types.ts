export interface WalletProvider {
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
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
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	functionArgs: any[];
	network?: string;
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
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
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	stx_transferStx: { params: TransferStxParams; result: any };
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	stx_callContract: { params: CallContractParams; result: any };
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	stx_deployContract: { params: DeployContractParams; result: any };
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	stx_signMessage: { params: SignMessageParams; result: any };
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	stx_signTransaction: { params: SignTransactionParams; result: any };
}

export type MethodParams<M extends keyof Methods> = Methods[M]["params"];
export type MethodResult<M extends keyof Methods> = Methods[M]["result"];
