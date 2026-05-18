// Sign and broadcast a contract call with post-conditions.
//
// Post-conditions assert the EXACT asset movements you expect. The default
// `postConditionMode: "deny"` will abort the tx if any movement isn't covered.
// This is your safety net against malicious or buggy contracts.
//
// Run:  STACKS_PRIVATE_KEY=0x... bun examples/stacks-call-contract.ts

import {
  createWalletClient,
  http,
  mainnet,
  parseStx,
} from "@secondlayer/stacks";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import { Cl } from "@secondlayer/stacks/clarity";
import { Pc } from "@secondlayer/stacks/postconditions";

const account = privateKeyToAccount(process.env.STACKS_PRIVATE_KEY!);

const wallet = createWalletClient({
  account,
  chain: mainnet,
  transport: http(),
});

// 1. Simple STX transfer with a post-condition
const txid1 = await wallet.transferStx({
  to: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
  amount: parseStx("1.5"), // 1.5 STX → microSTX
  memo: "payment for services",
  postConditions: [
    Pc.principal(account.address).willSendEq(parseStx("1.5")).ustx(),
  ],
  postConditionMode: "deny",
});
console.log("STX transfer:", txid1);

// 2. Contract call: send 100 USDA tokens
const TOKEN = "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.usda-token";
const RECIPIENT = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const AMOUNT = 100_000_000n; // assuming 6 decimals → 100 USDA

const txid2 = await wallet.callContract({
  contract: TOKEN,
  functionName: "transfer",
  functionArgs: [
    Cl.uint(AMOUNT),
    Cl.principal(account.address),
    Cl.principal(RECIPIENT),
    Cl.none(), // memo
  ],
  postConditions: [
    Pc.principal(account.address)
      .willSendEq(AMOUNT)
      .ft(TOKEN, "usda"),
  ],
  postConditionMode: "deny",
});
console.log("Token transfer:", txid2);

// 3. NFT transfer with `Pc.willSendAsset()` + `Cl.uint(tokenId)`
const NFT = "SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.byzantion-collection";
const TOKEN_ID = 42n;

const txid3 = await wallet.callContract({
  contract: NFT,
  functionName: "transfer",
  functionArgs: [
    Cl.uint(TOKEN_ID),
    Cl.principal(account.address),
    Cl.principal(RECIPIENT),
  ],
  postConditions: [
    Pc.principal(account.address)
      .willSendAsset()
      .nft(`${NFT}::byzantion-collection`, Cl.uint(TOKEN_ID)),
  ],
  postConditionMode: "deny",
});
console.log("NFT transfer:", txid3);
