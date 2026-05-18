// Read on-chain data with @secondlayer/stacks — no signing, no API key.
//
// Run:  bun examples/stacks-read.ts

import {
  createPublicClient,
  http,
  mainnet,
  formatStx,
} from "@secondlayer/stacks";
import { getContract } from "@secondlayer/stacks/actions";
import { SIP010_ABI, Cl } from "@secondlayer/stacks/clarity";

const ADDR = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const TOKEN_ADDR = "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9";
const TOKEN_NAME = "usda-token";

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
});

// 1. STX balance (microSTX, divide by 1e6 for STX)
const balance = await client.getBalance({ address: ADDR });
console.log(`STX balance: ${formatStx(balance)} STX`);

// 2. Block height
const height = await client.getBlockHeight();
console.log(`Tip: block #${height}`);

// 3. Read-only contract call (no fee, no tx)
const result = await client.readContract({
  contract: `${TOKEN_ADDR}.${TOKEN_NAME}`,
  functionName: "get-balance",
  args: [Cl.principal(ADDR)],
});
console.log("Raw Clarity result:", result);

// 4. Typed contract instance — auto-unwraps (ok ...) and converts kebab→camel
const token = getContract({
  client,
  address: TOKEN_ADDR,
  name: TOKEN_NAME,
  abi: SIP010_ABI,
});

const tokenBalance = await token.read.getBalance({ owner: ADDR });
const decimals = await token.read.getDecimals();
const symbol = await token.read.getSymbol();

console.log(`${symbol} balance: ${tokenBalance} (${decimals} decimals)`);

// 5. Batch reads — one HTTP round trip
const [name, totalSupply] = await client.multicall({
  calls: [
    {
      contract: `${TOKEN_ADDR}.${TOKEN_NAME}`,
      functionName: "get-name",
    },
    {
      contract: `${TOKEN_ADDR}.${TOKEN_NAME}`,
      functionName: "get-total-supply",
    },
  ],
  allowFailure: false,
});
console.log({ name, totalSupply });
