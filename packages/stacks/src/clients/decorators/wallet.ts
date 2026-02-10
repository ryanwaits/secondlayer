import type { Client } from "../types.ts";
import { sendTransaction, type SendTransactionParams, type SendTransactionResult } from "../../actions/wallet/sendTransaction.ts";
import { signTransactionAction, type SignTransactionParams } from "../../actions/wallet/signTransaction.ts";
import { transferStx, type TransferStxParams } from "../../actions/wallet/transferStx.ts";
import { callContract, type CallContractParams } from "../../actions/wallet/callContract.ts";
import { deployContract, type DeployContractParams } from "../../actions/wallet/deployContract.ts";
import { signMessage, type SignMessageParams } from "../../actions/wallet/signMessage.ts";
import { sponsorTransaction, type SponsorTransactionParams } from "../../actions/wallet/sponsorTransaction.ts";
import type { StacksTransaction } from "../../transactions/types.ts";

/** Signing actions: send transactions, transfer STX, call/deploy contracts, sign messages. */
export type WalletActions = {
  sendTransaction: (params: SendTransactionParams) => Promise<SendTransactionResult>;
  signTransaction: (params: SignTransactionParams) => Promise<StacksTransaction>;
  transferStx: (params: TransferStxParams) => Promise<string>;
  callContract: (params: CallContractParams) => Promise<string>;
  deployContract: (params: DeployContractParams) => Promise<string>;
  signMessage: (params: SignMessageParams) => Promise<string>;
  sponsorTransaction: (params: SponsorTransactionParams) => Promise<StacksTransaction>;
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
