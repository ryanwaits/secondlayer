/**
 * Verify code shown on more than one page (home's Verify band and /verify), so
 * the two never drift. Annotation comments render as margin notes in a figure.
 */

export const VERIFY_SDK = `import {
  SecondlayerProofSource,
  verifyBlock,
} from "@secondlayer/verify";

// !callout[/No key needed/] proofs are never billed
// No key needed; add apiKey for higher rate limits.
const source = new SecondlayerProofSource({
  baseUrl: "https://api.secondlayer.tools",
});

// !callout[/verifyBlock/] proven on your machine
const result = await verifyBlock(9_137_005, { source });

// !callout[/result.ok/] fails with the first broken link
if (!result.ok) {
  throw new Error(result.failures[0]?.message); // first broken link
}
console.log(result.stateRoot, result.diff?.writes.length);`;
