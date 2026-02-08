import type { Client } from "../clients/types.ts";
import { getContract } from "../actions/getContract.ts";
import { POX_ABI } from "./abi.ts";
import { POX_CONTRACTS } from "./constants.ts";
import { parseBtcAddress, validateLockPeriod } from "./utils.ts";
import { Pc } from "../postconditions/index.ts";
import type {
  StackStxParams,
  DelegateStxParams,
  StackExtendParams,
  StackIncreaseParams,
  PoxInfo,
  StackerInfo,
  DelegationInfo,
} from "./types.ts";

function getPoxContract(client: Client) {
  if (!client.chain) {
    throw new Error("Client must have a chain configured");
  }
  const network = client.chain.network;
  const contract =
    network === "mainnet" ? POX_CONTRACTS.mainnet : POX_CONTRACTS.testnet;

  return getContract({
    client,
    address: contract.address,
    name: contract.name,
    abi: POX_ABI,
  });
}

/** Query current PoX network info (cycle, minimum, lengths). */
export async function getPoxInfo(client: Client): Promise<PoxInfo> {
  const pox = getPoxContract(client);
  return (await pox.read["get-pox-info"]({})) as PoxInfo;
}

/** Get stacker info for an address. Returns null if not stacking. */
export async function getStackerInfo(
  client: Client,
  address: string
): Promise<StackerInfo | null> {
  const pox = getPoxContract(client);
  return (await pox.read["get-stacker-info"]({
    stacker: address,
  })) as StackerInfo | null;
}

/** Get delegation info for an address. Returns null if not delegating. */
export async function getDelegationInfo(
  client: Client,
  address: string
): Promise<DelegationInfo | null> {
  const pox = getPoxContract(client);
  return (await pox.read["get-delegation-info"]({
    stacker: address,
  })) as DelegationInfo | null;
}

/** Check if an amount meets the minimum stacking threshold. */
export async function canStack(
  client: Client,
  amount: bigint
): Promise<boolean> {
  const info = await getPoxInfo(client);
  return amount >= info.minAmountUstx;
}

/** Lock STX for stacking (solo). Requires wallet client. */
export async function stackStx(
  client: Client,
  params: StackStxParams
): Promise<string> {
  if (!client.account) throw new Error("Wallet client required");

  if (!validateLockPeriod(params.lockPeriod)) {
    throw new Error("Lock period must be 1-12 cycles");
  }

  const info = await getPoxInfo(client);
  if (params.amount < info.minAmountUstx) {
    throw new Error(`Amount below minimum: ${info.minAmountUstx}`);
  }

  const poxAddr = parseBtcAddress(params.btcAddress);
  const pox = getPoxContract(client);

  return pox.call["stack-stx"](
    {
      amountUstx: params.amount,
      poxAddr,
      startBurnHt: params.startBurnHeight,
      lockPeriod: BigInt(params.lockPeriod),
      signerSig: params.signerSig,
      signerKey: params.signerKey,
      maxAmount: params.maxAmount,
      authId: params.authId,
    },
    {
      postConditions: [
        Pc.principal(client.account.address).willSendEq(params.amount).ustx(),
      ],
    }
  );
}

/** Delegate STX to a pool operator. Requires wallet client. */
export async function delegateStx(
  client: Client,
  params: DelegateStxParams
): Promise<string> {
  if (!client.account) throw new Error("Wallet client required");

  const poxAddr = params.poxAddr ? parseBtcAddress(params.poxAddr) : null;
  const pox = getPoxContract(client);

  return pox.call["delegate-stx"]({
    amountUstx: params.amount,
    delegateTo: params.delegateTo,
    untilBurnHt: params.untilBurnHeight ?? null,
    poxAddr,
  });
}

/** Revoke an active delegation. Requires wallet client. */
export async function revokeDelegateStx(client: Client): Promise<string> {
  if (!client.account) throw new Error("Wallet client required");
  const pox = getPoxContract(client);
  return pox.call["revoke-delegate-stx"]({});
}

/** Extend an active stacking lock. Requires wallet client. */
export async function stackExtend(
  client: Client,
  params: StackExtendParams
): Promise<string> {
  if (!client.account) throw new Error("Wallet client required");

  if (!validateLockPeriod(params.extendCount)) {
    throw new Error("Extend count must be 1-12 cycles");
  }

  const poxAddr = parseBtcAddress(params.btcAddress);
  const pox = getPoxContract(client);

  return pox.call["stack-extend"]({
    extendCount: BigInt(params.extendCount),
    poxAddr,
    signerSig: params.signerSig,
    signerKey: params.signerKey,
    maxAmount: params.maxAmount,
    authId: params.authId,
  });
}

/** Increase the amount of locked STX. Requires wallet client. */
export async function stackIncrease(
  client: Client,
  params: StackIncreaseParams
): Promise<string> {
  if (!client.account) throw new Error("Wallet client required");

  const pox = getPoxContract(client);

  return pox.call["stack-increase"](
    {
      increaseBy: params.increaseBy,
      signerSig: params.signerSig,
      signerKey: params.signerKey,
      maxAmount: params.maxAmount,
      authId: params.authId,
    },
    {
      postConditions: [
        Pc.principal(client.account.address)
          .willSendEq(params.increaseBy)
          .ustx(),
      ],
    }
  );
}
