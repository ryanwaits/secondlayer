import { readFile } from "node:fs/promises";
import {
	type BlockVerification,
	BlockVerifier,
	MAINNET_CHECKPOINT,
	NodeRpcProofSource,
	type ProofSource,
	SecondlayerProofSource,
	type VerifyCheckpoint,
	type VerifyStep,
	parseNakamotoHeader,
	unhex,
} from "@secondlayer/verify";
import type { Command } from "commander";
import { dim, green, note, printError, red, writeData } from "../lib/output.ts";
import { resolveApiUrl, resolveDataPlaneKey } from "../lib/resolve-auth.ts";
import { VERIFY_EXIT } from "./verify.ts";

/**
 * `secondlayer verify block <height|index_block_hash>`: prove one Stacks block
 * from the checkpoint baked into this release. Every byte comes from an
 * untrusted source (the configured API, or a node for blocks and MARF proofs);
 * a lying source can make a link fail, never pass.
 *
 * Exit codes follow `secondlayer verify`:
 *   0  every link holds
 *   1  a link is broken (the first one is named)
 *   2  could not check: the source could not serve a link, or bad input
 */

export interface VerifyBlockOptions {
	/** Stacks node RPC for blocks and MARF proofs (self-host). */
	node?: string;
	/** Path to a checkpoint JSON that replaces the baked one. */
	checkpoint?: string;
	/** Also prove the Index API's rows for the block against its diff. */
	rows?: boolean;
	json?: boolean;
}

export interface VerifyBlockDeps {
	/** Proof source; defaults to the configured API, composed with `--node`. */
	source?: ProofSource;
}

/** The chain of links, in the order verifyBlock walks them. */
const LINKS: { step: VerifyStep; label: string }[] = [
	{ step: "ancestry", label: "ancestry" },
	{ step: "block", label: "block" },
	{ step: "bitcoin", label: "bitcoin" },
	{ step: "burn", label: "burn" },
	{ step: "signer-set", label: "cycle" },
	{ step: "signatures", label: "signatures" },
	{ step: "witness", label: "state root" },
	{ step: "names", label: "diff" },
	{ step: "rows", label: "rows" },
];
const LABEL_WIDTH = Math.max(...LINKS.map((l) => l.label.length));

const n = (v: number | bigint) => v.toLocaleString("en-US");

/** A height, or a 32-byte index block hash (0x optional). */
export function parseBlockRef(raw: string): number | string {
	if (/^\d+$/.test(raw)) {
		const height = Number(raw);
		if (Number.isSafeInteger(height)) return height;
	}
	const hash = raw.replace(/^0x/i, "").toLowerCase();
	if (/^[0-9a-f]{64}$/.test(hash)) return hash;
	throw new Error(
		`expected a block height or a 64-hex index block hash, got "${raw}"`,
	);
}

async function readCheckpoint(path: string): Promise<VerifyCheckpoint> {
	const cp = JSON.parse(await readFile(path, "utf8")) as VerifyCheckpoint;
	const ok =
		typeof cp?.stacks?.header === "string" &&
		Number.isSafeInteger(cp.stacks.cycle) &&
		typeof cp.stacks.signerSet === "string" &&
		Number.isSafeInteger(cp.bitcoin?.height) &&
		typeof cp.bitcoin?.header === "string";
	if (!ok)
		throw new Error(
			`${path}: a checkpoint needs stacks.{header, cycle, signerSet} and bitcoin.{height, header}`,
		);
	return cp;
}

function defaultSource(node?: string): ProofSource {
	const api = new SecondlayerProofSource({
		baseUrl: resolveApiUrl(),
		apiKey: resolveDataPlaneKey() ?? "",
	});
	return node ? { ...api, ...new NodeRpcProofSource({ nodeUrl: node }) } : api;
}

/**
 * The source verifyBlock sees: progress on the slow fetches. The verifier
 * reads state_writes and vm_events only when given `rows: true`.
 */
function prepareSource(src: ProofSource): ProofSource {
	const out: ProofSource = {
		getBlock: (ref) => src.getBlock(ref),
		getMarfProof: (path, tip) => src.getMarfProof(path, tip),
		getBurnPreimage: (ch) => src.getBurnPreimage(ch),
		getWitness: (id) => {
			note(`  fetching state witness ${id}`);
			return src.getWitness(id);
		},
		getBitcoinHeaders: (from, count) => {
			note(`  syncing Bitcoin headers ${n(from)}..${n(from + count - 1)}`);
			return src.getBitcoinHeaders(from, count);
		},
	};
	const { getEpoch2Header, getStateWrites, getVmEvents } = src;
	if (getEpoch2Header)
		out.getEpoch2Header = (id) => getEpoch2Header.call(src, id);
	if (getStateWrites)
		out.getStateWrites = (height) => getStateWrites.call(src, height);
	if (getVmEvents)
		out.getVmEvents = (height) => {
			note(`  fetching indexed rows for ${n(height)}`);
			return getVmEvents.call(src, height);
		};
	return out;
}

/** What each link proved, for the human view. */
function linkDetail(
	step: VerifyStep,
	r: BlockVerification,
	cp: VerifyCheckpoint,
	rows: boolean,
): string {
	switch (step) {
		case "ancestry": {
			const a = r.ancestry;
			if (!a) return "";
			const checkpoint = parseNakamotoHeader(unhex(cp.stacks.header));
			const start =
				a.fromHeight === Number(checkpoint.chainLength)
					? `the checkpoint ${n(a.fromHeight)}`
					: `block ${n(a.fromHeight)}`;
			return a.via === "marf"
				? `${n(r.height ?? 0)} proven in the state of ${start} (one MARF proof)`
				: `${n(r.height ?? 0)} reached from ${start} by parent links`;
		}
		case "block":
			return `${n(r.height ?? 0)}  ${r.blockId}`;
		case "bitcoin":
			return `headers ${n(cp.bitcoin.height)}..${n(r.burnHeight ?? 0)}, proof-of-work and retargets checked`;
		case "burn":
			return `height ${n(r.burnHeight ?? 0)}  ${r.bitcoinBlockHash}`;
		case "signer-set":
			return r.cycle === cp.stacks.cycle
				? `${r.cycle}, the checkpoint's own signer set`
				: `${r.cycle}, signer set proven forward from checkpoint cycle ${cp.stacks.cycle}`;
		case "signatures":
			return `${n(r.signerWeight ?? 0n)} / ${n(r.totalWeight ?? 0n)} weight signed, threshold ${n(r.threshold ?? 0n)}`;
		case "witness":
			return `${r.stateRoot} matches the witness`;
		case "names": {
			const d = r.diff;
			if (!d) return "";
			const named = d.writes.filter((w) => w.named).length;
			const written = named
				? `${d.writes.length} written (${named} named, ${d.writes.length - named} unnamed)`
				: `${d.writes.length} written (unnamed${rows ? "" : "; --rows names them"})`;
			return `${written}, ${d.carried.length} carried, ${d.internal.length} internal`;
		}
		case "rows":
			return `${n(r.rowsChecked ?? 0)} vm_events rows match the diff`;
	}
}

/**
 * Links a block below the checkpoint skips: its id is pinned by hash from a
 * trusted descendant, so no signer set or signatures; the burn block is bound
 * only when the synced Bitcoin chain reaches it.
 */
function notNeeded(step: VerifyStep, r: BlockVerification): boolean {
	if (!r.ancestry) return false;
	if (step === "bitcoin" || step === "burn") return r.burnHeight === undefined;
	return step === "signer-set" || step === "signatures";
}

/** One line per link, then the verdict. */
function report(
	r: BlockVerification,
	cp: VerifyCheckpoint,
	rows: boolean,
): void {
	const first = r.failures[0];
	const broken = first
		? LINKS.findIndex((l) => l.step === first.step)
		: LINKS.length;
	for (const [i, link] of LINKS.entries()) {
		const label = link.label.padEnd(LABEL_WIDTH);
		const failure = r.failures.find((f) => f.step === link.step);
		// Ancestry is a link only below the checkpoint.
		if (link.step === "ancestry" && !failure && !r.ancestry) continue;
		if (failure) writeData(`${red("✗")} ${label}  ${failure.message}`);
		else if (link.step === "rows" && !rows)
			writeData(dim(`· ${label}  not checked (pass --rows)`));
		else if (i > broken)
			writeData(dim(`· ${label}  not checked: an earlier link is broken`));
		else if (notNeeded(link.step, r))
			writeData(
				dim(
					`· ${label}  not needed: the block is hash-chained to the checkpoint`,
				),
			);
		else if (link.step === "rows" && r.rowsChecked === undefined)
			writeData(
				dim(`· ${label}  not checked: the source serves no indexed rows`),
			);
		else
			writeData(
				`${green("✓")} ${label}  ${linkDetail(link.step, r, cp, rows)}`,
			);
	}
	// Without --rows names were never asked for; the diff line already says so.
	for (const line of r.notes)
		if (rows || !line.includes("state_writes")) note(`  note: ${line}`);

	if (!first) {
		const from = n(parseNakamotoHeader(unhex(cp.stacks.header)).chainLength);
		writeData(
			green(
				`✓ Block ${n(r.height ?? 0)} is proven. Trusted: only the checkpoint (Stacks ${from}, Bitcoin ${n(cp.bitcoin.height)}).`,
			),
		);
		return;
	}
	const label = LINKS[broken]?.label ?? first.step;
	writeData(
		red(
			first.code === "unavailable"
				? `✗ Could not check the ${label} link: the source could not serve it.`
				: `✗ Not proven: the ${label} link is broken.`,
		),
	);
}

/** bigint weights as decimal strings; everything else as verifyBlock returned it. */
export function verificationJson(r: BlockVerification): string {
	return JSON.stringify(
		r,
		(_k, v) => (typeof v === "bigint" ? v.toString() : v),
		2,
	);
}

/** 0 proven, 1 a link is broken, 2 the source could not serve a link. */
function exitCodeOf(r: BlockVerification): number {
	if (r.ok) return VERIFY_EXIT.CLEAN;
	return r.failures[0]?.code === "unavailable"
		? VERIFY_EXIT.UNANCHORED
		: VERIFY_EXIT.DIVERGED;
}

/** Verify one block and print the result. Returns the exit code. */
export async function runVerifyBlock(
	ref: string,
	opts: VerifyBlockOptions,
	deps: VerifyBlockDeps = {},
): Promise<number> {
	let checkpoint: VerifyCheckpoint;
	let verifier: BlockVerifier;
	let target: number | string;
	try {
		target = parseBlockRef(ref);
		checkpoint = opts.checkpoint
			? await readCheckpoint(opts.checkpoint)
			: MAINNET_CHECKPOINT;
		const source = prepareSource(deps.source ?? defaultSource(opts.node));
		verifier = new BlockVerifier({ source, checkpoint, rows: !!opts.rows });
	} catch (err) {
		printError(err instanceof Error ? err.message : String(err));
		return VERIFY_EXIT.UNANCHORED;
	}

	note(`Verifying block ${typeof target === "number" ? n(target) : target}`);
	const result = await verifier.verify(target);
	if (opts.json) writeData(verificationJson(result));
	else report(result, checkpoint, !!opts.rows);
	return exitCodeOf(result);
}

export function attachVerifyBlockCommand(verify: Command): Command {
	return verify
		.command("block")
		.description(
			"Prove one Stacks block from the checkpoint built into this release, trusting nothing else",
		)
		.argument("<ref>", "block height or index block hash")
		.option(
			"--node <url>",
			"read blocks and MARF proofs from this Stacks node RPC instead of the API",
		)
		.option(
			"--checkpoint <file>",
			"trust this checkpoint JSON instead of the one built into this release",
		)
		.option(
			"--rows",
			"also prove the indexer's rows for the block (state_writes, vm_events) against its state diff",
		)
		.addHelpText(
			"after",
			`
What is proven, link by link:
  ancestry    below the checkpoint only: the block's id, from the checkpoint by
              parent links or one MARF proof (signer links are then not needed)
  bitcoin     headers from the checkpoint to the block's burn block: proof-of-work and retargets
  burn        the block's consensus hash commits to that Bitcoin block
  cycle       the reward cycle's signer set, proven forward from the checkpoint's set
  signatures  signers holding at least 70% of the weight signed the block header
  state root  the state witness hashes to the root in the signed header
  diff        every leaf the block wrote, carried, or kept as bookkeeping
  rows        with --rows: the Index API's rows match that diff

Nothing is trusted except the checkpoint. Proofs come from the API
(SECONDLAYER_API_URL, or --api-url) with your account key, or from a node
with --node; a source that lies can fail a link but never pass one.

Examples:
  $ secondlayer verify block 9137005
  $ secondlayer verify block 0x2e5962b00b8f243e1a4b5a1b7ff3076618ce5e737e30c019bc61e461c92f57ff
  $ secondlayer verify block 9137005 --node http://127.0.0.1:20443 --rows
  $ secondlayer verify block 9137005 --json

Output: one line per link on stdout, progress on stderr. --json prints the
full verification result instead (signer weights as decimal strings).

Exit codes:
  0  every link holds
  1  a link is broken (the first is named)
  2  could not check: the source could not serve a link, or bad input`,
		)
		.action(async (ref: string, opts: VerifyBlockOptions, cmd: Command) => {
			// `--json` belongs to the parent `verify`, which consumes it wherever it sits.
			const json = cmd.optsWithGlobals().json === true;
			process.exit(await runVerifyBlock(ref, { ...opts, json }));
		});
}
