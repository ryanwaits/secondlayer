// verifyBlock: the end-to-end trustless check for one Stacks block.
//
// At or above the checkpoint, forward:
//   checkpoint ─▶ bitcoin headers (PoW) ─▶ burn height ─▶ cycle ─▶ signer set[cycle] (MARF-proven)
//              ─▶ header N (signatures ≥ 70%) ─▶ witness N (root) ─▶ named diff ─▶ indexed rows
//
// Below it, backward: a trusted descendant's id commits to every ancestor by
// hash, so no signatures are needed:
//   checkpoint ─▶ id N (parent links, or one MARF proof of __MARF_BLOCK_HEIGHT_TO_HASH::N)
//              ─▶ header N (hashes to id N) ─▶ witness N (root) ─▶ named diff ─▶ indexed rows
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
import {
	type Epoch2Header,
	type NakamotoHeader,
	type StacksHeader,
	blockId,
	isEpoch2Header,
	parseEpoch2Header,
	parseNakamotoHeader,
} from "./header.ts";
import { mapEntryKey } from "./keys.ts";
import {
	MARF_VALUE_SIZE,
	heightToHashKey,
	marfPath,
	marfProofAncestors,
	marfProofValue,
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
	| "ancestry"
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
	/** The block is not the checkpoint chain's block at its height. */
	| "not-ancestor"
	| "ancestry-proof-invalid"
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

/** How a block below the checkpoint was tied to it. */
export interface Ancestry {
	/** Trusted descendant it was proven from: the checkpoint, or a block proven below it earlier. */
	fromHeight: number;
	fromBlockId: string;
	/**
	 * `parents`: each header hashes to the parent id its child commits to.
	 * `marf`: one MARF proof of `__MARF_BLOCK_HEIGHT_TO_HASH::<height>` against
	 * the descendant's state root.
	 */
	via: "parents" | "marf";
}

export interface BlockVerification {
	/**
	 * Every step passed. At or above the checkpoint: header, burn binding,
	 * signatures, state root, names and rows. Below it: ancestry, header,
	 * state root, names and rows (and the burn binding when Bitcoin reaches it).
	 */
	ok: boolean;
	height?: number;
	blockId?: string;
	/** The header's state_index_root, hex: what the witness must hash to. */
	stateRoot?: string;
	/** Set for blocks below the checkpoint, which need no signatures. */
	ancestry?: Ancestry;
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
	/**
	 * Also name the block's writes and prove its indexed rows: reads the
	 * source's `getStateWrites` and `getVmEvents`, which bill as Index rows on
	 * the Secondlayer API. Off by default, so verification reads proofs only.
	 */
	rows?: boolean;
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
/**
 * Below the checkpoint, ancestors this close to a trusted block are reached by
 * parent links (one block fetch each); farther ones by one MARF proof, which
 * costs the proof plus a header per ancestor trie it crosses.
 */
const MAX_WALK = 16;

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
	private readonly source: ProofSource;
	private readonly checkpoint: VerifyCheckpoint;
	private readonly rows: boolean;
	private readonly chain: HeaderChain;
	/** Proven signer sets by cycle. */
	private readonly sets = new Map<number, SignerSet>();
	/** Where each proven set was anchored: the lower bound for the next search. */
	private readonly anchors = new Map<number, SearchPoint>();
	/** Headers fetched by id, each checked to hash to it. */
	private readonly headers = new Map<string, StacksHeader>();
	/** Blocks proven on the checkpoint's chain below it, by height. */
	private readonly below = new Map<
		number,
		{ id: string; ancestry: Ancestry }
	>();
	private readonly burns = new Map<
		string,
		{ burnHeight: number; hash: string }
	>();
	/** Unverified source answers by consensus hash. */
	private readonly preimages = new Map<string, BurnPreimage>();
	private readonly start: { header: NakamotoHeader; id: string };

	constructor(opts: VerifyOptions) {
		this.source = opts.source;
		this.checkpoint = opts.checkpoint ?? MAINNET_CHECKPOINT;
		this.rows = opts.rows ?? false;
		const { stacks } = this.checkpoint;
		const header = parseNakamotoHeader(unhex(stacks.header));
		this.start = { header, id: hex(blockId(header)) };
		this.headers.set(this.start.id, header);
		this.sets.set(stacks.cycle, decodeSignerSet(stacks.signerSet));
		this.chain = HeaderChain.fromCheckpoint(this.checkpoint.bitcoin);
	}

	/** Verify one block by id (hex) or height. Never throws for bad source data. */
	async verify(ref: string | number): Promise<BlockVerification> {
		const out: BlockVerification = { ok: false, notes: [], failures: [] };
		try {
			await this.run(ref, out);
		} catch (err) {
			if (!(err instanceof Broken)) throw err;
			out.failures.unshift(err.failure);
		}
		out.ok = out.failures.length === 0;
		return out;
	}

	private async run(
		ref: string | number,
		out: BlockVerification,
	): Promise<void> {
		const start = Number(this.start.header.chainLength);
		if (typeof ref === "number" && ref < start)
			return this.runBelow(ref, undefined, out);
		let header: StacksHeader;
		if (typeof ref === "string") {
			const id = ref.replace(/^0x/, "").toLowerCase();
			header = await this.header(id, "block");
			const height = Number(header.chainLength);
			if (height < start) return this.runBelow(height, id, out);
			if (isEpoch2Header(header))
				fail({
					step: "block",
					code: "invalid-header",
					message: `epoch 2.x block ${id} claims height ${height}, at or above the checkpoint`,
				});
		} else {
			const raw = await fetchFor("block", `block ${ref}`, () =>
				this.source.getBlock(ref),
			);
			header = parseHeader(raw, "block");
		}
		const id = hex(blockId(header));
		const height = Number(header.chainLength);
		if (typeof ref === "number" && height !== ref)
			fail({
				step: "block",
				code: "height-mismatch",
				message: `source returned height ${height} for ${ref}`,
			});
		await this.runForward(header as NakamotoHeader, id, out);
	}

	/** At or above the checkpoint: Bitcoin, burn binding, signer set, signatures, state. */
	private async runForward(
		header: NakamotoHeader,
		id: string,
		out: BlockVerification,
	): Promise<void> {
		const height = Number(header.chainLength);
		out.height = height;
		out.blockId = id;
		out.stateRoot = hex(header.stateIndexRoot);

		const burn = await this.bindBurn(header, "burn");
		const cycle = rewardCycle(burn.burnHeight);
		out.burnHeight = burn.burnHeight;
		out.bitcoinBlockHash = burn.hash;
		out.cycle = cycle;

		const set = await this.signerSet(cycle, {
			height,
			burn: burn.burnHeight,
		});
		const sig = verifySignerSignatures(header, set);
		out.signerWeight = sig.signedWeight;
		out.totalWeight = sig.totalWeight;
		out.threshold = sig.threshold;
		if (!sig.valid) fail(signatureFailure(sig, "signatures", cycle));
		await this.verifyState(header, id, out);
	}

	/**
	 * Below the checkpoint: prove the checkpoint chain's id at `height` (and
	 * that it is `claimed`, when the caller asked by id), then the header that
	 * hashes to it, then its state. Signatures add nothing to a header pinned
	 * by hash from a trusted descendant.
	 */
	private async runBelow(
		height: number,
		claimed: string | undefined,
		out: BlockVerification,
	): Promise<void> {
		out.height = height;
		const { id, ancestry } = await this.ancestor(height);
		out.ancestry = ancestry;
		if (claimed !== undefined && claimed !== id)
			fail({
				step: "ancestry",
				code: "not-ancestor",
				message: `block ${claimed} is not on the checkpoint's chain: its block at height ${height} is ${id}`,
				blockId: claimed,
			});
		const header = await this.header(id, "block");
		if (Number(header.chainLength) !== height)
			fail({
				step: "block",
				code: "height-mismatch",
				message: `block ${id} claims height ${header.chainLength}, proven at ${height}`,
			});
		out.blockId = id;
		out.stateRoot = hex(header.stateIndexRoot);
		await this.bindBurnBelow(header, out);
		await this.verifyState(header, id, out);
	}

	/**
	 * The checkpoint chain's block id at `height`, from the nearest trusted
	 * block above it: parent links when within MAX_WALK, else one MARF proof.
	 */
	private async ancestor(
		height: number,
	): Promise<{ id: string; ancestry: Ancestry }> {
		const known = this.below.get(height);
		if (known) return known;
		const from = this.nearestAbove(height);
		if (from.height - height <= MAX_WALK) {
			const walked = await this.walk(from, height);
			if (walked) return walked;
		}
		return this.jump(this.nearestAbove(height), height);
	}

	/** The lowest trusted block above `height`: the checkpoint or one proven below it. */
	private nearestAbove(height: number): { height: number; id: string } {
		let best = {
			height: Number(this.start.header.chainLength),
			id: this.start.id,
		};
		for (const [h, { id }] of this.below)
			if (h > height && h < best.height) best = { height: h, id };
		return best;
	}

	/**
	 * Follow parent ids down from `from`: each parent header must hash to the
	 * id its child committed to. Null when a 2.x header stops the walk: it
	 * commits to its parent's block hash, not the parent's id.
	 */
	private async walk(
		from: { height: number; id: string },
		height: number,
	): Promise<{ id: string; ancestry: Ancestry } | null> {
		const ancestry: Ancestry = {
			fromHeight: from.height,
			fromBlockId: from.id,
			via: "parents",
		};
		let child = await this.header(from.id, "ancestry");
		for (let h = from.height - 1; h >= height; h--) {
			if (isEpoch2Header(child)) return null;
			const id = hex(child.parentBlockId);
			const parent = await this.header(id, "ancestry", { blockId: id });
			if (Number(parent.chainLength) !== h)
				fail({
					step: "ancestry",
					code: "height-mismatch",
					message: `parent ${id} claims height ${parent.chainLength}, expected ${h}`,
					blockId: id,
				});
			this.below.set(h, { id, ancestry });
			child = parent;
		}
		return this.below.get(height) ?? null;
	}

	/**
	 * Read the id at `height` from `from`'s state: block `height + 1` wrote it
	 * to `__MARF_BLOCK_HEIGHT_TO_HASH::<height>`, and the proof must recompute
	 * `from`'s state root through the header of every trie it crosses.
	 */
	private async jump(
		from: { height: number; id: string },
		height: number,
	): Promise<{ id: string; ancestry: Ancestry }> {
		const at = { blockId: from.id };
		const tip = await this.header(from.id, "ancestry", at);
		const key = heightToHashKey(height);
		const path = marfPath(key);
		const answer = await fetchFor(
			"ancestry",
			`${key} at ${from.id}`,
			() => this.source.getMarfProof(hex(path), from.id),
			at,
		);
		if (!answer)
			return fail({
				step: "ancestry",
				code: "unavailable",
				message: `source has no MARF proof of ${key} at block ${from.height}, ${from.height - height} blocks up; parent links reach ${MAX_WALK}`,
				...at,
			});
		// A block id fills the first 32 bytes of the MARFValue; the tail is zero.
		const value = marfProofValue(answer.proof) ?? new Uint8Array();
		const proven =
			value.length === MARF_VALUE_SIZE &&
			value.subarray(32).every((b) => b === 0) &&
			(await this.proveAt(tip, path, value, answer.proof, "ancestry", at));
		if (!proven)
			return fail({
				step: "ancestry",
				code: "ancestry-proof-invalid",
				message: `${key} is not proven in block ${from.height}'s state`,
				...at,
			});
		const ancestry: Ancestry = {
			fromHeight: from.height,
			fromBlockId: from.id,
			via: "marf",
		};
		const found = { id: hex(value.subarray(0, 32)), ancestry };
		this.below.set(height, found);
		return found;
	}

	/**
	 * Below the checkpoint the hash chain already pins the block; still bind
	 * its burn block when the Bitcoin checkpoint reaches it. The burn height
	 * here is the source's hint, so a low one only skips this extra check.
	 */
	private async bindBurnBelow(
		header: StacksHeader,
		out: BlockVerification,
	): Promise<void> {
		let hint: number;
		try {
			hint = await this.burnHint(header);
		} catch (err) {
			out.notes.push(`burn block not checked: ${(err as Error).message}`);
			return;
		}
		if (hint < this.chain.checkpointHeight) {
			out.notes.push(
				`burn block not checked: its height ${hint} is below the Bitcoin checkpoint ${this.chain.checkpointHeight}`,
			);
			return;
		}
		const burn = await this.bindBurn(header, "burn");
		out.burnHeight = burn.burnHeight;
		out.bitcoinBlockHash = burn.hash;
	}

	/** Witness against the authenticated header's root, then the named diff and rows. */
	private async verifyState(
		header: StacksHeader,
		id: string,
		out: BlockVerification,
	): Promise<void> {
		const src = this.source;
		const height = Number(header.chainLength);
		const witness = await fetchFor("witness", `witness ${id}`, () =>
			src.getWitness(id),
		);
		const { getStateWrites, getVmEvents }: Partial<ProofSource> = this.rows
			? src
			: {};
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
		const parent = isEpoch2Header(header)
			? epoch2ParentId(witness, header)
			: header.parentBlockId;
		const parentId = parent && hex(parent);
		const state = await verifyBlockState({
			height,
			// Null only when the witness fails its root check, which fails the block.
			parentBlockId: parent ?? new Uint8Array(32),
			stateRoot: header.stateIndexRoot,
			witness,
			writes,
			rows,
			parentLeaves: parentId
				? await this.parentLeaves(parentId, out.notes)
				: undefined,
			parentHolds: async (leaf) =>
				parentId ? this.parentHolds(parentId, leaf) : false,
		});
		out.diff = state.diff;
		if (rows) out.rowsChecked = state.rowsChecked;
		out.notes.push(...state.notes);
		out.failures.push(...state.failures);
	}

	/** Header by id, from the cache or the source; it must hash to `id`. */
	private async header(
		id: string,
		step: VerifyStep,
		extra: Partial<VerifyFailure> = {},
	): Promise<StacksHeader> {
		const known = this.headers.get(id);
		if (known) return known;
		const header = await this.fetchHeader(id, step, extra);
		if (hex(blockId(header)) !== id)
			fail({
				step,
				code: "id-mismatch",
				message: `source returned another block for ${id}`,
				blockId: id,
				...extra,
			});
		this.headers.set(id, header);
		return header;
	}

	/**
	 * A Nakamoto block by id, or when the source has none (epoch 2.x blocks are
	 * not served as Nakamoto blocks) its epoch 2.x header.
	 */
	private async fetchHeader(
		id: string,
		step: VerifyStep,
		extra: Partial<VerifyFailure>,
	): Promise<StacksHeader> {
		const src = this.source;
		let raw: Bytes;
		try {
			raw = await src.getBlock(id);
		} catch (err) {
			const reason = `block ${id}: ${(err as Error).message}`;
			const { getEpoch2Header } = src;
			if (!getEpoch2Header)
				return fail({ step, code: "unavailable", message: reason, ...extra });
			const e2 = await fetchFor(
				step,
				`${reason}; epoch 2.x header`,
				() => getEpoch2Header.call(src, id),
				extra,
			);
			try {
				return parseEpoch2Header(e2.header, e2.consensusHash);
			} catch (parseErr) {
				return fail({
					step,
					code: "invalid-header",
					message: `epoch 2.x header ${id} does not parse: ${(parseErr as Error).message}`,
					...extra,
				});
			}
		}
		return parseHeader(raw, step);
	}

	/**
	 * Prove `value` at `path` in `tip`'s state, fetching the header of every
	 * ancestor trie the proof crosses.
	 */
	private async proveAt(
		tip: StacksHeader,
		path: Bytes,
		value: Bytes,
		proof: Bytes,
		step: VerifyStep,
		extra: Partial<VerifyFailure> = {},
	): Promise<boolean> {
		const headers = [tip];
		for (const id of marfProofAncestors(proof))
			headers.push(await this.header(id, step, extra));
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
	private async parentLeaves(
		parentId: string,
		notes: string[],
	): Promise<WitnessLeaf[] | undefined> {
		try {
			const parent = await this.header(parentId, "names");
			const w = parseWitness(await this.source.getWitness(parentId));
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
	 * authenticated by hash: its id is committed in the authenticated child
	 * (its header, or for 2.x its own trie).
	 */
	private async parentHolds(
		parentId: string,
		leaf: WitnessLeaf,
	): Promise<boolean> {
		const parent = await this.header(parentId, "names");
		const pathHex = hex(leaf.path);
		const answer = await fetchFor("names", `MARF ${pathHex} at parent`, () =>
			this.source.getMarfProof(pathHex, parentId),
		);
		if (!answer) return false;
		const value = new Uint8Array(MARF_VALUE_SIZE);
		value.set(leaf.valueHash);
		return this.proveAt(parent, leaf.path, value, answer.proof, "names");
	}

	/** Consensus hash -> PoW-verified burn block, via the sortition preimage. */
	private async bindBurn(
		header: StacksHeader,
		step: VerifyStep,
		extra: Partial<VerifyFailure> = {},
	): Promise<{ burnHeight: number; hash: string }> {
		const ch = hex(header.consensusHash);
		const known = this.burns.get(ch);
		if (known) return known;
		const bp = await fetchFor(
			step,
			`burn preimage ${ch}`,
			() => this.preimage(ch),
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
		if (bp.burnHeight < this.chain.checkpointHeight)
			fail({
				step,
				code: "before-checkpoint",
				message: `burn height ${bp.burnHeight} is below the Bitcoin checkpoint ${this.chain.checkpointHeight}`,
				...extra,
			});
		await this.syncBitcoin(bp.burnHeight);
		const burnHeight = this.chain.heightOf(hash);
		if (burnHeight === undefined)
			return fail({
				step,
				code: "burn-not-in-chain",
				message: `burn block ${hash} is not in the verified Bitcoin chain (synced ${this.chain.checkpointHeight}..${this.chain.tip.height})`,
				...extra,
			});
		const bound = { burnHeight, hash };
		this.burns.set(ch, bound);
		return bound;
	}

	/** Extend the Bitcoin chain to `height`, validating PoW, retarget and MTP. */
	private async syncBitcoin(height: number): Promise<void> {
		while (this.chain.tip.height < height) {
			const from = this.chain.tip.height + 1;
			const count = Math.min(BITCOIN_BATCH, height - from + 1);
			const headers = await fetchFor("bitcoin", `bitcoin headers ${from}`, () =>
				this.source.getBitcoinHeaders(from, count),
			);
			if (headers.length === 0)
				fail({
					step: "bitcoin",
					code: "unavailable",
					message: `source has no Bitcoin headers from ${from}`,
				});
			try {
				this.chain.append(headers);
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
	private async signerSet(
		cycle: number,
		target: SearchPoint,
	): Promise<SignerSet> {
		const known = this.sets.get(cycle);
		if (known) return known;
		const first = this.checkpoint.stacks.cycle;
		if (cycle < first)
			fail({
				step: "signer-set",
				code: "before-checkpoint",
				message: `cycle ${cycle} precedes the checkpoint's cycle ${first}`,
				cycle,
			});
		let lo = await this.startPoint();
		for (let c = first; c < cycle; c++) {
			const next = this.sets.get(c + 1);
			if (next) {
				lo = this.anchors.get(c + 1) ?? lo;
				continue;
			}
			const anchor = await this.locateAnchor(c + 1, lo, target);
			this.sets.set(c + 1, await this.proveNextSet(c + 1, anchor));
			this.anchors.set(c + 1, anchor);
			lo = anchor;
		}
		return this.sets.get(cycle) as SignerSet;
	}

	/** The checkpoint block as a search bound; its burn height is a source hint. */
	private async startPoint(): Promise<SearchPoint> {
		const { header } = this.start;
		const height = Number(header.chainLength);
		try {
			return { height, burn: await this.burnHint(header) };
		} catch {
			return { height };
		}
	}

	private async burnHint(header: StacksHeader): Promise<number> {
		const ch = hex(header.consensusHash);
		return (
			this.burns.get(ch)?.burnHeight ?? (await this.preimage(ch)).burnHeight
		);
	}

	private async preimage(ch: string): Promise<BurnPreimage> {
		let bp = this.preimages.get(ch);
		if (!bp) {
			bp = await this.source.getBurnPreimage(ch);
			this.preimages.set(ch, bp);
		}
		return bp;
	}

	private async locateAnchor(
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
				() => this.source.getBlock(h),
				{ cycle },
			);
			const header = parseHeader(raw, "signer-set");
			const id = hex(blockId(header));
			this.headers.set(id, header);
			const burn = await fetchFor(
				"signer-set",
				`burn hint for block ${id}`,
				() => this.burnHint(header),
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
	private async proveNextSet(cycle: number, anchor: Probe): Promise<SignerSet> {
		const at = { cycle, blockId: anchor.id };
		const { burnHeight } = await this.bindBurn(anchor.header, "signer-set", at);
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
			this.sets.get(signing) as SignerSet,
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
			() => this.source.getMarfProof(hex(path), anchor.id),
			at,
		);
		const value = answer?.data.replace(/^0x/, "") ?? "";
		const proven =
			answer !== null &&
			(await this.proveAt(
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

/**
 * A 2.x header commits only to its parent's block hash; the parent's id is in
 * the block's own trie at `__MARF_BLOCK_HEIGHT_TO_HASH::<height - 1>`. Read
 * from a witness whose root matches the header, else null.
 */
function epoch2ParentId(witness: Bytes, header: Epoch2Header): Bytes | null {
	const height = Number(header.chainLength);
	if (height === 0) return null;
	try {
		const w = parseWitness(witness);
		if (!bytesEqual(w.root, header.stateIndexRoot)) return null;
		const path = marfPath(heightToHashKey(height - 1));
		return w.leaves.find((l) => bytesEqual(l.path, path))?.valueHash ?? null;
	} catch {
		return null;
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
