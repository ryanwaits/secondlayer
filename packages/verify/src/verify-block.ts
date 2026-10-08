// verifyBlock: the end-to-end trustless check for one Stacks block.
//
//   checkpoint ─▶ bitcoin headers (PoW) ─▶ burn height ─▶ cycle ─▶ signer set[cycle] (MARF-proven)
//              ─▶ header N (signatures ≥ 70%) ─▶ witness N (root) ─▶ named diff ─▶ indexed rows
//
// Every input comes from an untrusted ProofSource; only the checkpoint is trusted.
import { uintCV } from "@secondlayer/stacks/clarity";
import { HeaderChain, HeaderValidationError } from "./bitcoin/chain.ts";
import {
	MAINNET_PREPARE_LENGTH,
	cycleStart,
	rewardCycle,
	verifyConsensusPreimage,
} from "./burn.ts";
import { type Bytes, bytesEqual, hex, unhex } from "./bytes.ts";
import { MAINNET_CHECKPOINT, type VerifyCheckpoint } from "./checkpoint.ts";
import { type NakamotoHeader, blockId, parseNakamotoHeader } from "./header.ts";
import { mapEntryKey } from "./keys.ts";
import {
	MARF_VALUE_SIZE,
	marfPath,
	marfProofAncestors,
	marfValue,
	verifyMarfProof,
} from "./marf.ts";
import {
	SIGNERS_CONTRACT,
	type SignerSet,
	decodeSignerSet,
	verifySignerSignatures,
} from "./signers.ts";
import type { BurnPreimage, ProofSource } from "./source.ts";
import {
	type ProvenDiff,
	type StateFailureCode,
	verifyBlockState,
} from "./state.ts";
import { type WitnessLeaf, parseWitness } from "./witness.ts";

export type VerifyStep =
	| "block"
	| "bitcoin"
	| "burn"
	| "signer-set"
	| "signatures"
	| "witness"
	| "names"
	| "rows";

export type VerifyFailureCode =
	| StateFailureCode
	/** The source could not serve something the step needs. */
	| "unavailable"
	| "id-mismatch"
	| "height-mismatch"
	| "invalid-header"
	| "preimage-mismatch"
	| "burn-not-in-chain"
	| "before-checkpoint"
	| "anchor-not-found"
	| "anchor-outside-window"
	| "anchor-unsigned"
	| "set-proof-invalid"
	| "below-threshold"
	| "unknown-signer"
	| "duplicate-signer"
	| "bad-signature";

export interface VerifyFailure {
	step: VerifyStep;
	code: VerifyFailureCode;
	message: string;
	/** Reward cycle being proven (signer-set step). */
	cycle?: number;
	/** Block the failure is about, when not the target. */
	blockId?: string;
	key?: string;
	path?: string;
	ordinal?: number;
}

export interface BlockVerification {
	/** Every step passed: header, burn binding, signatures, state root, names and rows. */
	ok: boolean;
	height?: number;
	blockId?: string;
	/** The header's state_index_root, hex: what the witness must hash to. */
	stateRoot?: string;
	cycle?: number;
	burnHeight?: number;
	/** Display-order hex. */
	bitcoinBlockHash?: string;
	signerWeight?: bigint;
	totalWeight?: bigint;
	threshold?: bigint;
	diff?: ProvenDiff;
	/** vm_events rows proven against the diff. */
	rowsChecked?: number;
	notes: string[];
	/** Empty when ok. The first entry is the first broken link. */
	failures: VerifyFailure[];
}

export interface VerifyOptions {
	source: ProofSource;
	/** Defaults to MAINNET_CHECKPOINT. */
	checkpoint?: VerifyCheckpoint;
}

class Broken extends Error {
	constructor(readonly failure: VerifyFailure) {
		super(failure.message);
	}
}

const fail = (f: VerifyFailure): never => {
	throw new Broken(f);
};

/** Run a source call; a throw becomes an `unavailable` failure of `step`. */
async function fetchFor<T>(
	step: VerifyStep,
	what: string,
	call: () => Promise<T>,
	extra: Partial<VerifyFailure> = {},
): Promise<T> {
	try {
		return await call();
	} catch (err) {
		if (err instanceof Broken) throw err;
		return fail({
			step,
			code: "unavailable",
			message: `${what}: ${(err as Error).message}`,
			...extra,
		});
	}
}

const BITCOIN_BATCH = 2016;

/** A block position for the anchor search; `burn` is a source hint. */
export interface SearchPoint {
	height: number;
	burn?: number;
}

/**
 * Find a block whose burn height lies in `[window[0], window[1])`, between
 * `lo` and `hi` (exclusive). Interpolates on burn height, falling back to
 * bisection whenever a probe fails to halve the bracket. Burn heights here
 * are unproven hints: the caller authenticates whatever this returns.
 */
export async function findAnchor<T extends SearchPoint & { burn: number }>(
	low: SearchPoint,
	high: SearchPoint,
	window: readonly [number, number],
	probe: (height: number) => Promise<T>,
	maxProbes = 32,
): Promise<T | null> {
	let [lo, hi] = [low, high];
	const target = (window[0] + window[1]) / 2;
	let bisect = false;
	for (let i = 0; i < maxProbes; i++) {
		const span = hi.height - lo.height;
		if (span <= 1) return null;
		let h = Math.floor((lo.height + hi.height) / 2);
		if (
			!bisect &&
			lo.burn !== undefined &&
			hi.burn !== undefined &&
			hi.burn > lo.burn
		)
			h =
				lo.height +
				Math.round(((target - lo.burn) * span) / (hi.burn - lo.burn));
		h = Math.min(Math.max(h, lo.height + 1), hi.height - 1);
		const p = await probe(h);
		if (p.height <= lo.height || p.height >= hi.height) return null;
		if (p.burn >= window[0] && p.burn < window[1]) return p;
		if (p.burn < window[0]) lo = p;
		else hi = p;
		bisect = hi.height - lo.height > span / 2;
	}
	return null;
}

interface Probe extends SearchPoint {
	burn: number;
	header: NakamotoHeader;
	id: string;
}

/**
 * Verifies blocks from one checkpoint against one source, caching the Bitcoin
 * header chain, proven signer sets and fetched headers across calls.
 */
export class BlockVerifier {
	readonly #source: ProofSource;
	readonly #checkpoint: VerifyCheckpoint;
	readonly #chain: HeaderChain;
	/** Proven signer sets by cycle. */
	readonly #sets = new Map<number, SignerSet>();
	/** Where each proven set was anchored: the lower bound for the next search. */
	readonly #anchors = new Map<number, SearchPoint>();
	readonly #headers = new Map<string, NakamotoHeader>();
	readonly #burns = new Map<string, { burnHeight: number; hash: string }>();
	/** Unverified source answers by consensus hash. */
	readonly #preimages = new Map<string, BurnPreimage>();
	readonly #start: { header: NakamotoHeader; id: string };

	constructor(opts: VerifyOptions) {
		this.#source = opts.source;
		this.#checkpoint = opts.checkpoint ?? MAINNET_CHECKPOINT;
		const { stacks } = this.#checkpoint;
		const header = parseNakamotoHeader(unhex(stacks.header));
		this.#start = { header, id: hex(blockId(header)) };
		this.#headers.set(this.#start.id, header);
		this.#sets.set(stacks.cycle, decodeSignerSet(stacks.signerSet));
		this.#chain = HeaderChain.fromCheckpoint(this.#checkpoint.bitcoin);
	}

	/** Verify one block by id (hex) or height. Never throws for bad source data. */
	async verify(ref: string | number): Promise<BlockVerification> {
		const out: BlockVerification = { ok: false, notes: [], failures: [] };
		try {
			await this.#verify(ref, out);
		} catch (err) {
			if (!(err instanceof Broken)) throw err;
			out.failures.unshift(err.failure);
		}
		out.ok = out.failures.length === 0;
		return out;
	}

	async #verify(ref: string | number, out: BlockVerification): Promise<void> {
		const src = this.#source;
		const raw = await fetchFor("block", `block ${ref}`, () =>
			src.getBlock(ref),
		);
		const header = parseHeader(raw, "block");
		const id = hex(blockId(header));
		const height = Number(header.chainLength);
		if (typeof ref === "string" && id !== ref.replace(/^0x/, "").toLowerCase())
			fail({
				step: "block",
				code: "id-mismatch",
				message: `source returned block ${id} for ${ref}`,
			});
		if (typeof ref === "number" && height !== ref)
			fail({
				step: "block",
				code: "height-mismatch",
				message: `source returned height ${height} for ${ref}`,
			});
		out.height = height;
		out.blockId = id;
		out.stateRoot = hex(header.stateIndexRoot);

		const burn = await this.#bindBurn(header, "burn");
		const cycle = rewardCycle(burn.burnHeight);
		out.burnHeight = burn.burnHeight;
		out.bitcoinBlockHash = burn.hash;
		out.cycle = cycle;

		const set = await this.#signerSet(cycle, {
			height,
			burn: burn.burnHeight,
		});
		const sig = verifySignerSignatures(header, set);
		out.signerWeight = sig.signedWeight;
		out.totalWeight = sig.totalWeight;
		out.threshold = sig.threshold;
		if (!sig.valid) fail(signatureFailure(sig, "signatures", cycle));

		const witness = await fetchFor("witness", `witness ${id}`, () =>
			src.getWitness(id),
		);
		const { getStateWrites, getVmEvents } = src;
		const writes = getStateWrites
			? await fetchFor("names", `state_writes ${height}`, () =>
					getStateWrites.call(src, height),
				)
			: null;
		const rows = getVmEvents
			? await fetchFor("rows", `vm_events ${height}`, () =>
					getVmEvents.call(src, height),
				)
			: undefined;
		const parentId = hex(header.parentBlockId);
		const state = await verifyBlockState({
			height,
			parentBlockId: header.parentBlockId,
			stateRoot: header.stateIndexRoot,
			witness,
			writes,
			rows,
			parentLeaves: await this.#parentLeaves(parentId, out.notes),
			parentHolds: (leaf) => this.#parentHolds(parentId, leaf),
		});
		out.diff = state.diff;
		if (rows) out.rowsChecked = state.rowsChecked;
		out.notes.push(...state.notes);
		out.failures.push(...state.failures);
	}

	/** Header by id, from the cache or the source; the bytes must hash to `id`. */
	async #header(
		id: string,
		step: VerifyStep,
		extra: Partial<VerifyFailure> = {},
	): Promise<NakamotoHeader> {
		const known = this.#headers.get(id);
		if (known) return known;
		const raw = await fetchFor(
			step,
			`block ${id}`,
			() => this.#source.getBlock(id),
			extra,
		);
		const header = parseHeader(raw, step);
		if (hex(blockId(header)) !== id)
			fail({
				step,
				code: "id-mismatch",
				message: `source returned another block for ${id}`,
				blockId: id,
				...extra,
			});
		this.#headers.set(id, header);
		return header;
	}

	/**
	 * Prove `value` at `path` in `tip`'s state, fetching the header of every
	 * ancestor trie the proof crosses.
	 */
	async #proveAt(
		tip: NakamotoHeader,
		path: Bytes,
		value: Bytes,
		proof: Bytes,
		step: VerifyStep,
		extra: Partial<VerifyFailure> = {},
	): Promise<boolean> {
		const headers = [tip];
		for (const id of marfProofAncestors(proof))
			headers.push(await this.#header(id, step, extra));
		return verifyMarfProof({
			proof,
			path,
			value,
			root: tip.stateIndexRoot,
			headers,
		});
	}

	/**
	 * The parent's own trie leaves, from its witness checked against the
	 * parent header. Optional evidence: when the source cannot serve it,
	 * carried leaves fall back to per-leaf proofs (named) or stay unlabeled.
	 */
	async #parentLeaves(
		parentId: string,
		notes: string[],
	): Promise<WitnessLeaf[] | undefined> {
		try {
			const parent = await this.#header(parentId, "names");
			const w = parseWitness(await this.#source.getWitness(parentId));
			if (bytesEqual(w.root, parent.stateIndexRoot)) return w.leaves;
			notes.push(`parent witness ${parentId} root does not match its header`);
		} catch (err) {
			notes.push(
				`parent witness ${parentId} unavailable: ${(err as Error).message}`,
			);
		}
		return undefined;
	}

	/**
	 * A carried leaf holds the parent's value. The parent header is
	 * authenticated by hash: its id is committed in the signed child header.
	 */
	async #parentHolds(parentId: string, leaf: WitnessLeaf): Promise<boolean> {
		const parent = await this.#header(parentId, "names");
		const pathHex = hex(leaf.path);
		const answer = await fetchFor("names", `MARF ${pathHex} at parent`, () =>
			this.#source.getMarfProof(pathHex, parentId),
		);
		if (!answer) return false;
		const value = new Uint8Array(MARF_VALUE_SIZE);
		value.set(leaf.valueHash);
		return this.#proveAt(parent, leaf.path, value, answer.proof, "names");
	}

	/** Consensus hash -> PoW-verified burn block, via the sortition preimage. */
	async #bindBurn(
		header: NakamotoHeader,
		step: VerifyStep,
		extra: Partial<VerifyFailure> = {},
	): Promise<{ burnHeight: number; hash: string }> {
		const ch = hex(header.consensusHash);
		const known = this.#burns.get(ch);
		if (known) return known;
		const bp = await fetchFor(
			step,
			`burn preimage ${ch}`,
			() => this.#preimage(ch),
			extra,
		);
		const hash = verifyConsensusPreimage(header.consensusHash, bp.preimage);
		if (!hash)
			return fail({
				step,
				code: "preimage-mismatch",
				message: `preimage does not hash to consensus hash ${ch}`,
				...extra,
			});
		if (bp.burnHeight < this.#chain.checkpointHeight)
			fail({
				step,
				code: "before-checkpoint",
				message: `burn height ${bp.burnHeight} is below the Bitcoin checkpoint ${this.#chain.checkpointHeight}`,
				...extra,
			});
		await this.#syncBitcoin(bp.burnHeight);
		const burnHeight = this.#chain.heightOf(hash);
		if (burnHeight === undefined)
			return fail({
				step,
				code: "burn-not-in-chain",
				message: `burn block ${hash} is not in the verified Bitcoin chain (synced ${this.#chain.checkpointHeight}..${this.#chain.tip.height})`,
				...extra,
			});
		const bound = { burnHeight, hash };
		this.#burns.set(ch, bound);
		return bound;
	}

	/** Extend the Bitcoin chain to `height`, validating PoW, retarget and MTP. */
	async #syncBitcoin(height: number): Promise<void> {
		while (this.#chain.tip.height < height) {
			const from = this.#chain.tip.height + 1;
			const count = Math.min(BITCOIN_BATCH, height - from + 1);
			const headers = await fetchFor("bitcoin", `bitcoin headers ${from}`, () =>
				this.#source.getBitcoinHeaders(from, count),
			);
			if (headers.length === 0)
				fail({
					step: "bitcoin",
					code: "unavailable",
					message: `source has no Bitcoin headers from ${from}`,
				});
			try {
				this.#chain.append(headers);
			} catch (err) {
				if (!(err instanceof HeaderValidationError)) throw err;
				fail({ step: "bitcoin", code: "invalid-header", message: err.message });
			}
		}
	}

	/**
	 * The proven signer set for `cycle`. Walks forward from the checkpoint:
	 * set c+1 is read from an anchor block in c+1's prepare phase, whose
	 * header set c signed.
	 */
	async #signerSet(cycle: number, target: SearchPoint): Promise<SignerSet> {
		const known = this.#sets.get(cycle);
		if (known) return known;
		const first = this.#checkpoint.stacks.cycle;
		if (cycle < first)
			fail({
				step: "signer-set",
				code: "before-checkpoint",
				message: `cycle ${cycle} precedes the checkpoint's cycle ${first}`,
				cycle,
			});
		let lo = await this.#startPoint();
		for (let c = first; c < cycle; c++) {
			const next = this.#sets.get(c + 1);
			if (next) {
				lo = this.#anchors.get(c + 1) ?? lo;
				continue;
			}
			const anchor = await this.#findAnchor(c + 1, lo, target);
			this.#sets.set(c + 1, await this.#proveNextSet(c + 1, anchor));
			this.#anchors.set(c + 1, anchor);
			lo = anchor;
		}
		return this.#sets.get(cycle) as SignerSet;
	}

	/** The checkpoint block as a search bound; its burn height is a source hint. */
	async #startPoint(): Promise<SearchPoint> {
		const { header } = this.#start;
		const height = Number(header.chainLength);
		try {
			return { height, burn: await this.#burnHint(header) };
		} catch {
			return { height };
		}
	}

	async #burnHint(header: NakamotoHeader): Promise<number> {
		const ch = hex(header.consensusHash);
		return (
			this.#burns.get(ch)?.burnHeight ?? (await this.#preimage(ch)).burnHeight
		);
	}

	async #preimage(ch: string): Promise<BurnPreimage> {
		let bp = this.#preimages.get(ch);
		if (!bp) {
			bp = await this.#source.getBurnPreimage(ch);
			this.#preimages.set(ch, bp);
		}
		return bp;
	}

	async #findAnchor(
		cycle: number,
		lo: SearchPoint,
		hi: SearchPoint,
	): Promise<Probe> {
		const start = cycleStart(cycle);
		const window = [start - MAINNET_PREPARE_LENGTH, start] as const;
		const probe = async (h: number): Promise<Probe> => {
			const raw = await fetchFor(
				"signer-set",
				`block at height ${h}`,
				() => this.#source.getBlock(h),
				{ cycle },
			);
			const header = parseHeader(raw, "signer-set");
			const id = hex(blockId(header));
			this.#headers.set(id, header);
			const burn = await fetchFor(
				"signer-set",
				`burn hint for block ${id}`,
				() => this.#burnHint(header),
				{ cycle, blockId: id },
			);
			return { height: Number(header.chainLength), burn, header, id };
		};
		const anchor = await findAnchor(lo, hi, window, probe);
		if (!anchor)
			return fail({
				step: "signer-set",
				code: "anchor-not-found",
				message: `no block with a burn height in ${window[0]}..${window[1] - 1} (cycle ${cycle} prepare phase) between heights ${lo.height} and ${hi.height}`,
				cycle,
			});
		return anchor;
	}

	/**
	 * Set `cycle` from `anchor`: the anchor must be bound to a burn block in
	 * `cycle`'s prepare phase, be signed by the set of the cycle that burn
	 * height dictates (`cycle - 1`), and hold set `cycle` in its state (MARF
	 * proof). Adjacent sets overlap enough that one block can clear both, so
	 * the set is always chosen by proven burn height, never by which passes.
	 */
	async #proveNextSet(cycle: number, anchor: Probe): Promise<SignerSet> {
		const at = { cycle, blockId: anchor.id };
		const { burnHeight } = await this.#bindBurn(
			anchor.header,
			"signer-set",
			at,
		);
		const start = cycleStart(cycle);
		if (burnHeight < start - MAINNET_PREPARE_LENGTH || burnHeight >= start)
			fail({
				step: "signer-set",
				code: "anchor-outside-window",
				message: `anchor burn height ${burnHeight} is outside cycle ${cycle}'s prepare phase ${start - MAINNET_PREPARE_LENGTH}..${start - 1}`,
				...at,
			});
		const signing = rewardCycle(burnHeight);
		const sig = verifySignerSignatures(
			anchor.header,
			this.#sets.get(signing) as SignerSet,
		);
		if (!sig.valid)
			fail({
				...signatureFailure(sig, "signer-set", signing),
				...at,
				code: "anchor-unsigned",
			});

		const path = marfPath(
			mapEntryKey(SIGNERS_CONTRACT, "cycle-signer-set", uintCV(cycle)),
		);
		const answer = await fetchFor(
			"signer-set",
			`signer set ${cycle} at ${anchor.id}`,
			() => this.#source.getMarfProof(hex(path), anchor.id),
			at,
		);
		const value = answer?.data.replace(/^0x/, "") ?? "";
		const proven =
			answer !== null &&
			(await this.#proveAt(
				anchor.header,
				path,
				marfValue(value),
				answer.proof,
				"signer-set",
				at,
			));
		if (!proven)
			fail({
				step: "signer-set",
				code: "set-proof-invalid",
				message: `signer set ${cycle} is not proven in anchor ${anchor.id}'s state`,
				...at,
			});
		let set: SignerSet;
		try {
			set = decodeSignerSet(value);
		} catch (err) {
			return fail({
				step: "signer-set",
				code: "set-proof-invalid",
				message: `signer set ${cycle}: ${(err as Error).message}`,
				...at,
			});
		}
		return set;
	}
}

function parseHeader(raw: Bytes, step: VerifyStep): NakamotoHeader {
	try {
		return parseNakamotoHeader(raw);
	} catch (err) {
		return fail({
			step,
			code: "invalid-header",
			message: `block bytes do not parse: ${(err as Error).message}`,
		});
	}
}

function signatureFailure(
	sig: ReturnType<typeof verifySignerSignatures>,
	step: VerifyStep,
	cycle: number,
): VerifyFailure {
	const weight = `${sig.signedWeight}/${sig.totalWeight} signed, threshold ${sig.threshold}`;
	if (sig.unknown.length)
		return {
			step,
			code: "unknown-signer",
			message: `${sig.unknown.length} signer(s) not in cycle ${cycle}'s set (${weight})`,
			cycle,
		};
	if (sig.duplicates.length)
		return {
			step,
			code: "duplicate-signer",
			message: `${sig.duplicates.length} duplicate signature(s) (${weight})`,
			cycle,
		};
	if (sig.invalid)
		return {
			step,
			code: "bad-signature",
			message: `${sig.invalid} signature(s) do not recover (${weight})`,
			cycle,
		};
	return {
		step,
		code: "below-threshold",
		message: `cycle ${cycle} signers: ${weight}`,
		cycle,
	};
}

/** One-shot: verify a block from a checkpoint (MAINNET_CHECKPOINT by default). */
export const verifyBlock = (
	ref: string | number,
	opts: VerifyOptions,
): Promise<BlockVerification> => new BlockVerifier(opts).verify(ref);
