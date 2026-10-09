/**
 * SYNTHETIC stand-in for the recorded mainnet replay window.
 *
 * The plan records Stacks 1,230,195..1,230,205 (amm-vault-v2-01 `reserve`,
 * including `reserve[token-wkiki]` at ordinal 19 of 1,230,200): proofs from
 * `/v1/proofs/*` and one single-block `state_writes` SELECT per height from
 * the feeder. On 2026-10-09 the re-syncing feeder had no `state_writes` at
 * 1,230,195 yet, so this module builds a window of the same shape instead:
 * same heights, contract, map and ordinal-19 write, with
 *
 *   - transactions: mainnet block 8,199,502's first transaction with its
 *     nonce rewritten per (height, index), so every txid is distinct and
 *     every tx still decodes (signatures are not checked here);
 *   - writes: reserve updates plus noise a state feed must drop (account
 *     keys, another contract's map, a block-level var write).
 *
 * The block proofs are not real either: tests verify through a fake verifier
 * whose names check holds the window's true diff. TODO(after feeder v2 passes
 * 1,230,205, ~Oct 17-19): record the real window and swap this module for a
 * loader of those files; replay-e2e.test.ts keeps its assertions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contractPrincipalCV, serializeCV } from "@secondlayer/stacks/clarity";
import { splitTransactions } from "@secondlayer/stacks/transactions";
import { txidFromBytes } from "@secondlayer/stacks/utils";
import {
	type BlockVerification,
	type StateWrite,
	parseNakamotoHeader,
	unhex,
} from "@secondlayer/verify";

export const FROM = 1_230_195;
export const TO = 1_230_205;
export const WKIKI_HEIGHT = 1_230_200;
export const WKIKI_ORDINAL = 19;

const DEPLOYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
export const POOL = `${DEPLOYER}.amm-vault-v2-01`;
const OTHER = `${DEPLOYER}.amm-pool-v2-01`;
const TOKENS = ["token-alex", "token-wstx", "token-wkiki", "token-abtc"];

/** The `reserve` map key for a token, as the node serializes it. */
export const tokenKey = (name: string): string =>
	serializeCV(contractPrincipalCV(DEPLOYER, name));
const uint = (n: bigint) => `01${n.toString(16).padStart(32, "0")}`;
const stored = (s: string) => Buffer.from(s, "utf8").toString("hex");

export interface FixtureBlock {
	height: number;
	blockId: string;
	blockHash: string;
	timestamp: number;
	burnHeight: number;
	txs: { txid: string; raw: Uint8Array }[];
	writes: StateWrite[];
}

const BASE_TX = (() => {
	const raw = unhex(
		readFileSync(
			join(import.meta.dir, "../../verify/test/fixtures/blocks/8199502.hex"),
			"utf8",
		).trim(),
	);
	const body = raw.subarray(parseNakamotoHeader(raw).byteLength);
	return splitTransactions(body.subarray(4), 2)[0] as Uint8Array;
})();

/** Single-sig standard auth: the nonce sits after version, chain id, auth
 *  type, hash mode and the 20-byte signer. */
const NONCE_OFFSET = 1 + 4 + 1 + 1 + 20;

function tx(height: number, index: number) {
	const raw = BASE_TX.slice();
	new DataView(raw.buffer, raw.byteOffset).setBigUint64(
		NONCE_OFFSET,
		BigInt(height * 100 + index),
	);
	return { txid: txidFromBytes(raw), raw };
}

const hex32 = (seed: string) =>
	Buffer.from(new Bun.CryptoHasher("sha256").update(seed).digest()).toString(
		"hex",
	);

/** The window, oldest first. */
export function syntheticWindow(): FixtureBlock[] {
	const blocks: FixtureBlock[] = [];
	for (let height = FROM; height <= TO; height++) {
		const writes: StateWrite[] = [];
		const push = (txIndex: number | null, key: string, value: string) =>
			writes.push({
				ordinal: writes.length,
				tx_index: txIndex,
				key,
				value_hex: stored(value),
			});
		// Block-level and account noise first, as a block's opening writes are.
		push(null, `vm::${POOL}::1::last-sync`, uint(BigInt(height)));
		push(0, "vm-account::SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7::19", "00");
		if (height === WKIKI_HEIGHT) {
			// Pad to put the plan 110 regression write at ordinal 19.
			while (writes.length < WKIKI_ORDINAL)
				push(
					1,
					`vm::${OTHER}::0::reserve::${tokenKey("token-alex")}`,
					`0a${uint(BigInt(writes.length))}`,
				);
			push(
				1,
				`vm::${POOL}::0::reserve::${tokenKey("token-wkiki")}`,
				`0a${uint(4_200_000n)}`,
			);
		}
		if (height % 2 === 1) {
			const token = TOKENS[height % TOKENS.length] as string;
			push(
				1,
				`vm::${POOL}::0::reserve::${tokenKey(token)}`,
				`0a${uint(BigInt(height))}`,
			);
			push(
				2,
				`vm::${POOL}::0::reserve::${tokenKey(token)}`,
				`0a${uint(BigInt(height) + 1n)}`,
			);
		}
		const txCount = Math.max(3, ...writes.map((w) => (w.tx_index ?? 0) + 1));
		const id = hex32(`synthetic block ${height}`);
		blocks.push({
			height,
			blockId: id,
			blockHash: hex32(`synthetic hash ${height}`),
			timestamp: 1_735_000_000 + height,
			burnHeight: 875_000 + Math.floor((height - FROM) / 3),
			txs: Array.from({ length: txCount }, (_, i) => tx(height, i)),
			writes,
		});
	}
	return blocks;
}

/**
 * What `verifyBlock` would report for a fixture block, given the writes a
 * source serves for it: the names check fails as the real one does when a
 * leaf of the block's true diff is not named, or a served write names a key
 * the block did not write.
 */
export function verifyFixtureBlock(
	block: FixtureBlock,
	served: StateWrite[],
): BlockVerification {
	const out: BlockVerification = {
		ok: true,
		height: block.height,
		blockId: block.blockId,
		blockHash: block.blockHash,
		consensusHash: "cd".repeat(20),
		timestamp: block.timestamp,
		burnHeight: block.burnHeight,
		transactions: block.txs,
		diff: { named: true, writes: [], carried: [], internal: [] },
		writes: served,
		notes: [],
		failures: [],
	};
	const leaves = new Set(block.writes.map((w) => w.key));
	const named = new Set(served.map((w) => w.key));
	const hidden = [...leaves].find((k) => !named.has(k));
	const missing = [...named].find((k) => !leaves.has(k));
	if (hidden)
		out.failures.push({
			step: "names",
			code: "hidden-write",
			message: `leaf ${hidden} is not a named write, a carried parent value or MARF bookkeeping`,
		});
	else if (missing)
		out.failures.push({
			step: "names",
			code: "missing-write",
			message: `state write ${missing} has no leaf holding its value`,
		});
	out.ok = out.failures.length === 0;
	return out;
}
