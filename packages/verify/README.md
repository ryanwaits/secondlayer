# @secondlayer/verify

Check a Stacks block yourself instead of trusting the API or node that served it. An index you can check, not one you have to trust.

`verifyBlock` walks one chain of links, from a checkpoint shipped in this package to the block's state:

```
checkpoint -> Bitcoin headers (proof of work) -> burn block -> signer set (MARF proof)
           -> header signatures (70% of signer weight) -> state witness (state root) -> state diff
```

Every byte comes from a source you don't have to trust. A lying source can make a link fail, never pass. Powers `secondlayer verify block` in [`@secondlayer/cli`](https://www.npmjs.com/package/@secondlayer/cli).

## Install

```bash
bun add @secondlayer/verify
```

## Usage

```ts
import { SecondlayerProofSource, verifyBlock } from "@secondlayer/verify";

const source = new SecondlayerProofSource({
  baseUrl: "https://api.secondlayer.tools",
  apiKey: process.env.SECONDLAYER_API_KEY!, // any account key; proofs are never billed
});

const result = await verifyBlock(9_137_005, { source });
if (!result.ok) throw new Error(result.failures[0]?.message); // first broken link
console.log(result.blockId, result.stateRoot, result.diff?.writes.length);
```

With your own node, blocks and MARF proofs come from its RPC. Witnesses, burn preimages and Bitcoin headers still come from the API, checked the same way:

```ts
import { NodeRpcProofSource } from "@secondlayer/verify";

const source = {
  ...new SecondlayerProofSource({ baseUrl: "https://api.secondlayer.tools", apiKey }),
  ...new NodeRpcProofSource({ nodeUrl: "http://localhost:20443" }),
};
```

`verifyBlock` never throws for bad source data: it returns `ok: false` with `failures`, the first entry being the first broken link. Use `BlockVerifier` to verify many blocks from one checkpoint and reuse the synced Bitcoin headers and proven signer sets.

`SecondlayerProofSource` also reads `state_writes` and `vm_events` from the Index API, which bill as rows. To check proofs only, leave them out: `const { getStateWrites, getVmEvents, ...proofs } = source`.

## What it proves

| Proven | How |
| --- | --- |
| The block is the one asked for | header hash and height |
| It was elected by a Bitcoin block | consensus hash preimage, burn header in the synced chain |
| The Bitcoin chain | every header from the checkpoint: proof of work, retargets, median time |
| The cycle's signers signed it | signer set proven by MARF against an earlier signed block, then 70% of weight |
| Its state | the witness recomputes the header's state root |
| Every key it wrote | with `state_writes`: each written leaf is named, nothing hidden |
| Indexed rows | with `state_writes` and `vm_events`: each row matches a leaf the block wrote |

## What it trusts, and what it doesn't cover

- **The checkpoint.** `MAINNET_CHECKPOINT` (Stacks block 8,956,304, cycle 143 signers, Bitcoin block 967,680) is trusted as-is. Pass `checkpoint` to use your own.
- **Bitcoin heights.** Blocks whose burn height is below the checkpoint's Bitcoin block can't be verified. Headers are checked for valid work, not compared against a competing chain, and reorgs past the synced tip are not followed.
- **Names need `state_writes`.** Without them every write is still proven, but unnamed; `notes` says so.
- **Not covered:** print events (Stacks headers don't commit to them) and transaction contents.

## Docs

[secondlayer.tools/docs/cli](https://www.secondlayer.tools/docs/cli) covers `secondlayer verify block` and the `/v1/proofs` API it reads.

## License

MIT
