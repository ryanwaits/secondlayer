import {
	type CallContractParams,
	callContract,
} from "../../actions/wallet/callContract.ts";
import {
	type DeployContractParams,
	deployContract,
} from "../../actions/wallet/deployContract.ts";
import {
	type SendTransactionParams,
	type SendTransactionResult,
	sendTransaction,
} from "../../actions/wallet/sendTransaction.ts";
import {
	type SignMessageParams,
	signMessage,
} from "../../actions/wallet/signMessage.ts";
import {
	type SignTransactionParams,
	signTransactionAction,
} from "../../actions/wallet/signTransaction.ts";
import {
	type SponsorTransactionParams,
	sponsorTransaction,
} from "../../actions/wallet/sponsorTransaction.ts";
import {
	type TransferStxParams,
	transferStx,
} from "../../actions/wallet/transferStx.ts";
import type { StacksTransaction } from "../../transactions/types.ts";
import type { Client } from "../types.ts";

/** Signing actions: send transactions, transfer STX, call/deploy contracts, sign messages. */
export type WalletActions = {
	sendTransaction: (
		params: SendTransactionParams,
	) => Promise<SendTransactionResult>;
	signTransaction: (
		params: SignTransactionParams,
	) => Promise<StacksTransaction>;
	transferStx: (params: TransferStxParams) => Promise<string>;
	callContract: (params: CallContractParams) => Promise<string>;
	deployContract: (params: DeployContractParams) => Promise<string>;
	signMessage: (params: SignMessageParams) => Promise<string>;
	sponsorTransaction: (
		params: SponsorTransactionParams,
	) => Promise<StacksTransaction>;
};

/** Decorator that binds {@link WalletActions} to a client instance. */
export function walletActions(client: Client): WalletActions {
	return {
		sendTransaction: (params) => sendTransaction(client, params),
		signTransaction: (params) => signTransactionAction(client, params),
		transferStx: (params) => transferStx(client, params),
		callContract: (params) => callContract(client, params),
		deployContract: (params) => deployContract(client, params),
		signMessage: (params) => signMessage(client, params),
		sponsorTransaction: (params) => sponsorTransaction(client, params),
	};
}
