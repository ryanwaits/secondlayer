# Simnet transport

Clarinet simnet as a client transport. Same `getContract` / public actions as HTTP, against an in-process VM.

```ts
import { initSimnet } from "@stacks/clarinet-sdk";
import { createPublicClient } from "@secondlayer/stacks";
import { getContract } from "@secondlayer/stacks/actions";
import { simnet, simnetChain } from "@secondlayer/stacks/simnet";

const session = await initSimnet("./Clarinet.toml");
const client = createPublicClient({
  chain: simnetChain,
  transport: simnet(session),
});

const c = getContract({
  client,
  address: session.getAccounts().get("deployer")!,
  name: "counter",
  abi: counterAbi,
});

await c.read.getCount();
```

`@stacks/clarinet-sdk` is an optional peer of this entry. The root SDK does not load it.

No `/extended` index (except receipts of txs this transport mined). Watches throw `SimnetUnsupportedError`. Fee estimate is `NoEstimateAvailable` so wallet actions fall back to `'min'`.
