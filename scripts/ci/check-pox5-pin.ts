/**
 * pox-5 pin check — guards the seam the simnet tests can't see.
 *
 * The pox5 simnet suites validate our wrappers against the pox-5 contract
 * EMBEDDED in @stacks/clarinet-sdk, which is a snapshot taken before the
 * final stacks-core release (known text drift: admin-principal initializers,
 * the BITCOIN_LOCKTIME_THRESHOLD assert, reward-settlement gas refactors).
 * This script fetches the contract actually shipped at the pinned
 * stacks-core tag and fails CI if:
 *
 *   1. the fetched file's sha256 no longer matches the pin (tag rewritten,
 *      or STACKS_CORE_TAG bumped without re-pinning the hash), or
 *   2. the public/read-only function signatures differ between the shipped
 *      contract and clarinet's embedded copy — i.e. the ABI our simnet
 *      tests pin against is no longer the ABI on mainnet.
 *
 * Body-text drift (case 1 diffs that don't touch signatures) is reported
 * but does not fail — it's expected until clarinet ships the final contract.
 *
 *   bun scripts/ci/check-pox5-pin.ts
 */
import { resolve } from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { initSimnet } from "@stacks/clarinet-sdk";

const STACKS_CORE_TAG = "4.0.1";
const POX5_SHA256 =
	"ffad35ad181d85832ebd7b998f445204c92d5cd19549166e644fb1f3988fa385";
const RAW_URL = `https://raw.githubusercontent.com/stacks-network/stacks-core/${STACKS_CORE_TAG}/stackslib/src/chainstate/stacks/boot/pox-5.clar`;
const POX5_ID = "SP000000000000000000002Q6VF78.pox-5";
const MANIFEST = resolve(import.meta.dir, "../../contracts/Clarinet.toml");

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Strip `;;` line comments so they can't confuse signature parsing. */
function stripComments(source: string): string {
	return source
		.split("\n")
		.map((line) => {
			const idx = line.indexOf(";;");
			return idx === -1 ? line : line.slice(0, idx);
		})
		.join("\n");
}

/**
 * Extract `name → normalized signature` for every define-public /
 * define-read-only. The signature is the paren-balanced `(name (arg type) …)`
 * form with whitespace collapsed, so arg names, order, and types all count.
 */
function extractSignatures(source: string): Map<string, string> {
	const clean = stripComments(source);
	const sigs = new Map<string, string>();
	const re = /\(define-(?:public|read-only)\s*\(/g;
	for (let m = re.exec(clean); m !== null; m = re.exec(clean)) {
		const start = re.lastIndex - 1; // opening paren of the signature list
		let depth = 0;
		let end = start;
		for (let i = start; i < clean.length; i++) {
			const ch = clean[i];
			if (ch === "(") depth++;
			else if (ch === ")") {
				depth--;
				if (depth === 0) {
					end = i + 1;
					break;
				}
			}
		}
		if (depth !== 0) throw new Error("unbalanced parens in contract source");
		const sig = clean.slice(start, end).replace(/\s+/g, " ").trim();
		const name = sig.slice(1).split(/[\s)]/, 1)[0] as string;
		sigs.set(name, sig);
	}
	return sigs;
}

const response = await fetch(RAW_URL);
if (!response.ok) {
	console.error(`FAIL: fetch ${RAW_URL} → ${response.status}`);
	process.exit(1);
}
const shipped = await response.text();

const digest = toHex(sha256(new TextEncoder().encode(shipped)));
if (digest !== POX5_SHA256) {
	console.error(
		`FAIL: pox-5.clar at stacks-core ${STACKS_CORE_TAG} hashes to ${digest}, pinned ${POX5_SHA256}.`,
		"\nThe tag content changed or STACKS_CORE_TAG was bumped without re-pinning — re-review the contract diff, then update POX5_SHA256.",
	);
	process.exit(1);
}

const simnet = await initSimnet(MANIFEST);
const embedded = simnet.getContractSource(POX5_ID);
if (!embedded) {
	console.error(`FAIL: simnet has no source for ${POX5_ID}`);
	process.exit(1);
}

const shippedSigs = extractSignatures(shipped);
const embeddedSigs = extractSignatures(embedded);

const problems: string[] = [];
for (const [name, sig] of shippedSigs) {
	const other = embeddedSigs.get(name);
	if (!other) problems.push(`missing from clarinet's embedded copy: ${sig}`);
	else if (other !== sig)
		problems.push(`signature drift: shipped ${sig} vs embedded ${other}`);
}
for (const name of embeddedSigs.keys()) {
	if (!shippedSigs.has(name))
		problems.push(`embedded-only function (removed upstream?): ${name}`);
}

if (problems.length > 0) {
	console.error(
		`FAIL: pox-5 ABI drift between stacks-core ${STACKS_CORE_TAG} and clarinet's embedded contract — the simnet-pinned tests no longer test the mainnet ABI:`,
	);
	for (const p of problems) console.error(`  - ${p}`);
	process.exit(1);
}

const textIdentical = shipped === embedded;
console.log(
	`OK: ${shippedSigs.size} public/read-only signatures match between stacks-core ${STACKS_CORE_TAG} and clarinet's embedded pox-5.`,
);
if (textIdentical) {
	console.log(
		"Embedded contract is byte-identical to the shipped tag — the known-drift note in this script can be removed.",
	);
} else {
	console.log(
		"Note: body text still differs (expected — clarinet snapshot predates the final release); signatures are the enforced surface.",
	);
}
