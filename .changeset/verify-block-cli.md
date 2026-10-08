---
"@secondlayer/cli": minor
---

`secondlayer verify block <height|index_block_hash>` proves one Stacks block from the checkpoint built into the CLI: Bitcoin headers, burn block, signer set, signatures, state root, and state diff, with `--rows` for the Index rows. `--node` reads blocks and MARF proofs from your node; `--checkpoint` swaps the trusted starting point.
