import { SecondLayer, verifyTransactionProof } from "@secondlayer/sdk";

const txId = process.argv[2];
if (!txId) throw new Error("usage: bun transactions.getProof.ts <tx_id>");

const sl = new SecondLayer();

const proof = await sl.index.transactions.getProof(txId);
// !callout[/proof/] Null when the transaction is not found.
if (!proof) throw new Error(`no proof for ${txId}`);

// !callout[/verifyTransactionProof/] Recomputes the txid, merkle path, and header hash locally. Nothing in the proof is trusted.
const result = verifyTransactionProof(proof);

console.log(result.level, result.ok ? "verified" : result.errors.join("; "));
