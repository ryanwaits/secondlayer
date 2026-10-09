# @secondlayer/verify

Check a Stacks block yourself instead of trusting the API or node that served it. An index you can check, not one you have to trust.

`verifyBlock` walks one chain of links, from a checkpoint shipped in this package to the block's state:

```
checkpoint -> Bitcoin headers (proof of work) -> burn block -> signer set (MARF proof)
           -> header signatures (70% of signer weight) -> transactions (tx merkle root)
           -> state witness (state root) -> state diff
```

Blocks below the checkpoint take a shorter chain. The checkpoint's header commits to every ancestor by hash, so no signatures are needed:

```
checkpoint -> block id at that height (parent links, or one MARF proof) -> header hashes to the id
           -> transactions (tx merkle root) -> state witness (state root) -> state diff
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

Heights below the checkpoint need no extra options: `verifyBlock(150_000, { source })` derives the direction. Within 16 blocks of a trusted block the verifier follows `parent_block_id` links. Farther down it asks the source for one MARF proof of `__MARF_BLOCK_HEIGHT_TO_HASH::<height>` at the checkpoint: each block writes its parent's id there, so the proof names the ancestor and is checked against the checkpoint's state root. Pre-Nakamoto (2.x) blocks need a source with `getEpoch2Header`, which both sources here implement.

`verifyBlock` never throws for bad source data: it returns `ok: false` with `failures`, the first entry being the first broken link. Use `BlockVerifier` to verify many blocks from one checkpoint and reuse the synced Bitcoin headers and proven signer sets.

By default only proofs are read, and proofs are free. That includes the block's state writes (`/v1/proofs/writes/{height}`), which name every written leaf of the diff; `result.writes` holds them and each named `diff.writes` entry carries its proven `value`. A source with no writes for the block (the API answers 404 until its node delivers `state_writes` for that height) leaves the diff proven but unnamed, with a note; it is never a failure. Pass `rows: true` to also check the indexed `vm_events` rows, which bill as Index rows on the Secondlayer API.

```ts
await verifyBlock(9_137_005, { source, rows: true });
```

## What it proves

| Proven | How |
| --- | --- |
| The block is the one asked for | header hash and height |
| It was elected by a Bitcoin block | consensus hash preimage, burn header in the synced chain |
| The Bitcoin chain | every header from the checkpoint: proof of work, retargets, median time |
| The cycle's signers signed it | signer set proven by MARF against an earlier signed block, then 70% of weight |
| Its transactions | every transaction parses and the txids hash to the header's tx merkle root (`result.transactions`) |
| Its state | the witness recomputes the header's state root |
| Every key it wrote | a source with `state_writes` for the block: each written leaf is named, nothing hidden |
| Indexed rows | `rows: true`: each `vm_events` row matches a leaf the block wrote |
| Below the checkpoint: it is the checkpoint chain's block at that height | parent links or a MARF proof from the checkpoint's state root, then the header (Nakamoto or 2.x) hashes to that id |

## What it trusts, and what it doesn't cover

- **The checkpoint.** `MAINNET_CHECKPOINT` (Stacks block 8,956,304, cycle 143 signers, Bitcoin block 967,680) is trusted as-is. Pass `checkpoint` to use your own.
- **Bitcoin heights.** At or above the checkpoint, a block's burn block must be at or above the checkpoint's Bitcoin block. Below the checkpoint the burn block is checked only when it is (with the baked checkpoint it never is); the hash chain pins those blocks instead. Headers are checked for valid work, not compared against a competing chain, and reorgs past the synced tip are not followed.
- **MARF proofs of `__MARF_*` keys.** A node's `/v2/clarity/marf` answers only keys with a stored value string, and these have none. The API's `/v1/proofs/marf` falls back to its proof sidecar for them; with `NodeRpcProofSource` alone, blocks more than 16 below a trusted block fail `ancestry` as `unavailable`.
- **Epoch 2.x consensus hashes.** A 2.x header commits to its parent's block hash, not its id. The id always comes from a trusted descendant (its header, or a MARF proof), and the source's consensus hash must hash with the header to it. State proofs for 2.x heights are against the anchored block's root, which covers the microblocks it confirms.
- **Names need `state_writes`.** Without them every write is still proven, but unnamed; `notes` says so.
- **Transactions need the block body.** Epoch 2.x blocks, and a source that serves the header only, skip the `txs` link with a note. The root binds each transaction's bytes (sender, type, call target, arguments), not which transaction made which write, nor whether it succeeded.
- **Not covered:** print events and transaction results (Stacks headers don't commit to them).

## Docs

[secondlayer.tools/docs/cli](https://www.secondlayer.tools/docs/cli) covers `secondlayer verify block` and the `/v1/proofs` API it reads.

## License

MIT
