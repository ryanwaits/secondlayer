import type { Client } from "../clients/types.ts";
import { getContract } from "../actions/getContract.ts";
import { SIP010_ABI } from "../clarity/abi/standards.ts";
import {
  STACKING_DAO_CORE_ABI,
  DATA_CORE_V1_ABI,
  DATA_CORE_V3_ABI,
  RESERVE_V1_ABI,
} from "./abi.ts";
import { STACKINGDAO_CONTRACTS, TRAIT_CONTRACTS } from "./constants.ts";
import { Pc } from "../postconditions/index.ts";
import type {
  DepositParams,
  InitWithdrawParams,
  WithdrawParams,
  WithdrawIdleParams,
  ExchangeRateInfo,
  WithdrawalInfo,
  FeeInfo,
} from "./types.ts";

function assertMainnet(client: Client) {
  if (!client.chain) {
    throw new Error("Client must have a chain configured");
  }
  if (client.chain.network !== "mainnet") {
    throw new Error("StackingDAO is only available on mainnet");
  }
}

function getCoreContract(client: Client) {
  assertMainnet(client);
  const c = STACKINGDAO_CONTRACTS.core;
  return getContract({ client, address: c.address, name: c.name, abi: STACKING_DAO_CORE_ABI });
}

function getStstxToken(client: Client) {
  assertMainnet(client);
  const c = STACKINGDAO_CONTRACTS.ststxToken;
  return getContract({ client, address: c.address, name: c.name, abi: SIP010_ABI });
}

function getDataCoreV1(client: Client) {
  assertMainnet(client);
  const c = STACKINGDAO_CONTRACTS.dataCoreV1;
  return getContract({ client, address: c.address, name: c.name, abi: DATA_CORE_V1_ABI });
}

function getDataCoreV3(client: Client) {
  assertMainnet(client);
  const c = STACKINGDAO_CONTRACTS.dataCore;
  return getContract({ client, address: c.address, name: c.name, abi: DATA_CORE_V3_ABI });
}

function getReserveContract(client: Client) {
  assertMainnet(client);
  const c = STACKINGDAO_CONTRACTS.reserve;
  return getContract({ client, address: c.address, name: c.name, abi: RESERVE_V1_ABI });
}

const traits = {
  reserve: TRAIT_CONTRACTS.reserve,
  commissionContract: TRAIT_CONTRACTS.commission,
  stakingContract: TRAIT_CONTRACTS.staking,
  directHelpers: TRAIT_CONTRACTS.directHelpers,
};

// ── User Actions ──

export async function deposit(client: Client, params: DepositParams): Promise<string> {
  const core = getCoreContract(client);
  return core.call.deposit(
    {
      ...traits,
      stxAmount: params.amount,
      referrer: params.referrer ?? null,
      pool: params.pool ?? null,
    },
    {
      postConditions: [
        Pc.principal(client.account!.address).willSendEq(params.amount).ustx(),
      ],
    },
  );
}

export async function initWithdraw(client: Client, params: InitWithdrawParams): Promise<string> {
  const core = getCoreContract(client);
  const ststx = STACKINGDAO_CONTRACTS.ststxToken;
  return core.call["init-withdraw"](
    {
      reserve: traits.reserve,
      directHelpers: traits.directHelpers,
      ststxAmount: params.ststxAmount,
    },
    {
      postConditions: [
        Pc.principal(client.account!.address)
          .willSendEq(params.ststxAmount)
          .ft(`${ststx.address}.${ststx.name}`, "ststx"),
      ],
    },
  );
}

export async function withdraw(client: Client, params: WithdrawParams): Promise<string> {
  const core = getCoreContract(client);
  return core.call.withdraw({
    reserve: traits.reserve,
    commissionContract: traits.commissionContract,
    stakingContract: traits.stakingContract,
    nftId: params.nftId,
  });
}

export async function withdrawIdle(client: Client, params: WithdrawIdleParams): Promise<string> {
  const core = getCoreContract(client);
  const ststx = STACKINGDAO_CONTRACTS.ststxToken;
  return core.call["withdraw-idle"](
    {
      reserve: traits.reserve,
      directHelpers: traits.directHelpers,
      commissionContract: traits.commissionContract,
      stakingContract: traits.stakingContract,
      ststxAmount: params.ststxAmount,
    },
    {
      postConditions: [
        Pc.principal(client.account!.address)
          .willSendEq(params.ststxAmount)
          .ft(`${ststx.address}.${ststx.name}`, "ststx"),
      ],
    },
  );
}

// ── Read-only Queries ──

export async function getStSTXBalance(client: Client, address: string): Promise<bigint> {
  const token = getStstxToken(client);
  return (await token.read["get-balance"]({ account: address })) as bigint;
}

export async function getExchangeRate(client: Client): Promise<ExchangeRateInfo> {
  const reserve = getReserveContract(client);
  const dataV3 = getDataCoreV3(client);

  const [totalStx, ststxSupply] = await Promise.all([
    reserve.read["get-total-stx"]({}) as Promise<bigint>,
    getTotalSupply(client),
  ]);

  const stxPerStstx = (await dataV3.read["get-stx-per-ststx-helper"]({
    stxAmount: totalStx,
  })) as bigint;

  return { stxPerStstx, ststxSupply, totalStx };
}

export async function getTotalSupply(client: Client): Promise<bigint> {
  const token = getStstxToken(client);
  return (await token.read["get-total-supply"]({})) as bigint;
}

export async function getWithdrawalInfo(
  client: Client,
  nftId: bigint,
): Promise<WithdrawalInfo> {
  const dataV1 = getDataCoreV1(client);
  return (await dataV1.read["get-withdrawals-by-nft"]({
    nftId,
  })) as WithdrawalInfo;
}

export async function getFees(client: Client): Promise<FeeInfo> {
  const core = getCoreContract(client);
  const [stackFee, unstackFee, withdrawIdleFee] = await Promise.all([
    core.read["get-stack-fee"]({}) as Promise<bigint>,
    core.read["get-unstack-fee"]({}) as Promise<bigint>,
    core.read["get-withdraw-idle-fee"]({}) as Promise<bigint>,
  ]);
  return { stackFee, unstackFee, withdrawIdleFee };
}

export async function getReserveBalance(client: Client): Promise<bigint> {
  const reserve = getReserveContract(client);
  return (await reserve.read["get-total-stx"]({})) as bigint;
}

export async function getShutdownDeposits(client: Client): Promise<boolean> {
  const core = getCoreContract(client);
  return (await core.read["get-shutdown-deposits"]({})) as boolean;
}
