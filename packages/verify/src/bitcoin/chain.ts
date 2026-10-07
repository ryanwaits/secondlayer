/**
 * Minimal Bitcoin header-chain light client (SPV), mainnet rules only.
 *
 * Trust model: the checkpoint header is trusted as-is. Every header appended
 * after it must link to the current tip and satisfy proof-of-work, the
 * difficulty rule (unchanged bits mid-period, exact retarget every 2016
 * blocks), median-time-past, and the BIP34/66/65 minimum version.
 *
 * Append-only: there is no reorg handling. A header that does not extend the
 * tip (a fork, or a replay of a known header) is rejected. Callers that need
 * to follow reorgs should rebuild from a checkpoint safely below the fork.
 *
 * Not checked (needs wall-clock or block bodies): the "time too far in the
 * future" rule, and anything about transactions/merkle roots.
 */

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
	type BlockHeader,
	HEADER_SIZE,
	headerHash,
	parseHeader,
	reverseBytes,
} from "./header.ts";
import {
	RETARGET_INTERVAL,
	bitsToTarget,
	checkProofOfWork,
	headerWork,
	nextRetargetBits,
} from "./pow.ts";

/** Number of previous blocks whose median timestamp a new block must exceed. */
export const MEDIAN_TIME_SPAN = 11;
/** Mainnet height from which version ≥ 4 is required (BIP65; implies BIP34/66). */
export const BIP65_HEIGHT = 388_381;

export type HeaderRule =
	| "checkpoint"
	| "format"
	| "prev-link"
	| "bits"
	| "retarget"
	| "median-time-past"
	| "version"
	| "proof-of-work";

export class HeaderValidationError extends Error {
	override readonly name = "HeaderValidationError";
	constructor(
		readonly height: number,
		readonly rule: HeaderRule,
		detail: string,
	) {
		super(`header at height ${height} failed ${rule}: ${detail}`);
	}
}

export interface Checkpoint {
	height: number;
	/** Raw 80-byte header, bytes or hex. Trusted without validation. */
	header: Uint8Array | string;
	/**
	 * Timestamp of the first block of the checkpoint's difficulty period
	 * (height − height % 2016). Required when the checkpoint is not itself a
	 * period start; needed to verify the next retarget.
	 */
	periodStartTime?: number;
}

export interface ChainEntry {
	height: number;
	/** Display-order hex. */
	hash: string;
	header: BlockHeader;
	raw: Uint8Array;
}

const hex8 = (n: number) => `0x${n.toString(16).padStart(8, "0")}`;

export class HeaderChain {
	private readonly entries: ChainEntry[] = [];
	private readonly heights = new Map<string, number>();
	private work = 0n;

	private constructor(
		private readonly base: number,
		private readonly periodStartTime: number,
	) {}

	static fromCheckpoint(checkpoint: Checkpoint): HeaderChain {
		const { height } = checkpoint;
		if (!Number.isSafeInteger(height) || height < 0) {
			throw new HeaderValidationError(
				height,
				"checkpoint",
				"height must be a non-negative integer",
			);
		}
		const raw = toRaw(checkpoint.header, height);
		const header = parseHeader(raw);
		try {
			bitsToTarget(header.bits);
		} catch (err) {
			throw new HeaderValidationError(
				height,
				"checkpoint",
				(err as Error).message,
			);
		}
		const atPeriodStart = height % RETARGET_INTERVAL === 0;
		let periodStartTime = checkpoint.periodStartTime;
		if (atPeriodStart) {
			if (periodStartTime !== undefined && periodStartTime !== header.time) {
				throw new HeaderValidationError(
					height,
					"checkpoint",
					`periodStartTime ${periodStartTime} disagrees with the period-start checkpoint's own time ${header.time}`,
				);
			}
			periodStartTime = header.time;
		} else if (periodStartTime === undefined) {
			throw new HeaderValidationError(
				height,
				"checkpoint",
				`periodStartTime is required for a checkpoint inside a difficulty period (period starts at ${height - (height % RETARGET_INTERVAL)})`,
			);
		}
		const chain = new HeaderChain(height, periodStartTime);
		chain.push(raw, header);
		return chain;
	}

	get tip(): ChainEntry {
		return this.entries[this.entries.length - 1] as ChainEntry;
	}

	/** Work summed from the checkpoint (inclusive) to the tip; not chainwork since genesis. */
	get totalWork(): bigint {
		return this.work;
	}

	get checkpointHeight(): number {
		return this.base;
	}

	/** Height of a header in this chain by display-order hash, or undefined. */
	heightOf(hashHex: string): number | undefined {
		return this.heights.get(hashHex.toLowerCase());
	}

	headerAt(height: number): ChainEntry | undefined {
		return this.entries[height - this.base];
	}

	/**
	 * Validates and appends headers in order. All-or-nothing: if any header
	 * fails, the chain is left exactly as it was and the error is thrown.
	 */
	append(headers: Iterable<Uint8Array | string>): void {
		const before = this.entries.length;
		const workBefore = this.work;
		try {
			for (const item of headers) {
				const height = this.tip.height + 1;
				const raw = toRaw(item, height);
				this.validate(height, raw, parseHeader(raw));
			}
		} catch (err) {
			for (const removed of this.entries.splice(before)) {
				this.heights.delete(removed.hash);
			}
			this.work = workBefore;
			throw err;
		}
	}

	private validate(height: number, raw: Uint8Array, header: BlockHeader): void {
		const prev = this.tip;

		if (header.prevHash !== prev.hash) {
			const known = this.heights.get(header.prevHash);
			throw new HeaderValidationError(
				height,
				"prev-link",
				known === undefined
					? `prevHash ${header.prevHash} does not match tip ${prev.hash} at ${prev.height}`
					: `prevHash points at height ${known}, not the tip at ${prev.height} (forks/reorgs are not supported)`,
			);
		}

		const expectedBits = this.expectedBits(height, prev);
		if (header.bits !== expectedBits) {
			const atRetarget = height % RETARGET_INTERVAL === 0;
			throw new HeaderValidationError(
				height,
				atRetarget ? "retarget" : "bits",
				atRetarget
					? `bits ${hex8(header.bits)} != retargeted ${hex8(expectedBits)}`
					: `bits ${hex8(header.bits)} != previous ${hex8(expectedBits)} (only height % ${RETARGET_INTERVAL} == 0 may change difficulty)`,
			);
		}

		const mtp = this.medianTimePast();
		if (header.time <= mtp) {
			throw new HeaderValidationError(
				height,
				"median-time-past",
				`time ${header.time} <= median of previous ${Math.min(MEDIAN_TIME_SPAN, this.entries.length)} blocks (${mtp})`,
			);
		}

		if (height >= BIP65_HEIGHT && header.version < 4) {
			throw new HeaderValidationError(
				height,
				"version",
				`version ${header.version} < 4 (required from height ${BIP65_HEIGHT})`,
			);
		}

		const hash = headerHash(raw);
		if (!checkProofOfWork(hash, header.bits)) {
			throw new HeaderValidationError(
				height,
				"proof-of-work",
				`hash ${bytesToHex(reverseBytes(hash))} exceeds target for bits ${hex8(header.bits)}`,
			);
		}

		this.push(raw, header, hash);
	}

	private expectedBits(height: number, prev: ChainEntry): number {
		if (height % RETARGET_INTERVAL !== 0) return prev.header.bits;
		const firstHeight = height - RETARGET_INTERVAL;
		const firstTime =
			firstHeight < this.base
				? this.periodStartTime
				: (this.headerAt(firstHeight) as ChainEntry).header.time;
		return nextRetargetBits(prev.header.bits, firstTime, prev.header.time);
	}

	/**
	 * Median of the last 11 timestamps. Right after the checkpoint fewer are
	 * known; like Core near genesis, the median of what is available is used.
	 */
	private medianTimePast(): number {
		const times = this.entries
			.slice(-MEDIAN_TIME_SPAN)
			.map((e) => e.header.time)
			.sort((a, b) => a - b);
		return times[Math.floor(times.length / 2)] as number;
	}

	private push(raw: Uint8Array, header: BlockHeader, hash = headerHash(raw)) {
		const height = this.base + this.entries.length;
		const hashHex = bytesToHex(reverseBytes(hash));
		this.entries.push({ height, hash: hashHex, header, raw });
		this.heights.set(hashHex, height);
		this.work += headerWork(header.bits);
	}
}

function toRaw(item: Uint8Array | string, height: number): Uint8Array {
	let raw: Uint8Array;
	try {
		// Copy so later mutation of the caller's buffer cannot alter the chain.
		raw = typeof item === "string" ? hexToBytes(item) : Uint8Array.from(item);
	} catch {
		throw new HeaderValidationError(
			height,
			"format",
			"header is not valid hex",
		);
	}
	if (raw.length !== HEADER_SIZE) {
		throw new HeaderValidationError(
			height,
			"format",
			`header must be ${HEADER_SIZE} bytes, got ${raw.length}`,
		);
	}
	return raw;
}
