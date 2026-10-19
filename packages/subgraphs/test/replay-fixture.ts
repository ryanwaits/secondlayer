/**
 * The recorded mainnet replay window: Stacks 1,230,195..1,230,205.
 *
 * Recorded 2026-10-19 by `capture-replay-fixtures.ts` into
 * `fixtures/replay-1230195/`:
 *
 *   - blocks/<id>.bin, witnesses/<id>.bin, marf/<path>@<tip>.bin (proof
 *     bytes) + marf.json (values), epoch2.json, burn.json:
 *     every answer `BlockVerifier` read from `api.secondlayer.tools/v1/proofs/*`
 *     to verify the window from `MAINNET_CHECKPOINT` (the window's blocks, the
 *     parent of 1,230,195, the one MARF ancestry jump, the headers its proofs
 *     cross, the tenure's burn preimage);
 *   - writes/<height>.json: each block's `state_writes` rows, from one
 *     single-block query per height on a node that stores them.
 *
 * The window holds one `amm-vault-v2-01` `reserve` write: `reserve[token-wkiki]`
 * at ordinal 5 of 1,230,200 (the plan 110 regression). Everything else is
 * noise a state feed must drop (account nonces and balances, other
 * contracts' maps, `_stx-data::ustx_liquid_supply`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { deserializeCV } from "@secondlayer/stacks/clarity";
import {
	type BlockTransaction,
	type BurnPreimage,
	type Bytes,
	type Epoch2HeaderResponse,
	type MarfProofResponse,
	type NakamotoHeader,
	type ProofSource,
	type StateWrite,
	blockId,
	blockTransactions,
	hex,
	parseNakamotoHeader,
	signerSignatureHash,
	unhex,
} from "@secondlayer/verify";

export const DIR = join(import.meta.dir, "fixtures", "replay-1230195");

export const FROM = 1_230_195;
export const TO = 1_230_205;
export const POOL = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-vault-v2-01";
export const WKIKI = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-wkiki";

const readJson = <T>(file: string): T =>
	JSON.parse(readFileSync(join(DIR, file), "utf8")) as T;

const binaries = (sub: string) =>
	new Map(
		readdirSync(join(DIR, sub)).map((f): [string, Bytes] => [
			f.replace(/\.bin$/, ""),
			new Uint8Array(readFileSync(join(DIR, sub, f))),
		]),
	);

/** A ProofSource over the recording; anything not recorded is a thrown miss. */
export class FakeProofSource implements ProofSource {
	readonly blocks = binaries("blocks");
	readonly witnesses = binaries("witnesses");
	/** Recorded MARF answers by `<path>@<tip>`: the value, null when absent. */
	readonly marf = readJson<Record<string, string | null>>("marf.json");
	readonly marfProofs = binaries("marf");
	readonly epoch2 =
		readJson<Record<string, { header: string; consensus_hash: string }>>(
			"epoch2.json",
		);
	readonly burn =
		readJson<Record<string, { preimage: string; burn_height: number }>>(
			"burn.json",
		);
	readonly writes = new Map<number, StateWrite[]>(
		readdirSync(join(DIR, "writes")).map((f): [number, StateWrite[]] => [
			Number(f.replace(/\.json$/, "")),
			readJson<StateWrite[]>(join("writes", f)),
		]),
	);

	getBlock = async (ref: string | number): Promise<Bytes> => {
		const raw = typeof ref === "string" && this.blocks.get(ref);
		if (!raw) throw new Error(`no recorded block ${ref}`);
		return raw;
	};

	getEpoch2Header = async (id: string): Promise<Epoch2HeaderResponse> => {
		const h = this.epoch2[id];
		if (!h) throw new Error(`no recorded epoch 2.x header ${id}`);
		return { header: unhex(h.header), consensusHash: unhex(h.consensus_hash) };
	};

	getMarfProof = async (
		path: string,
		tip: string,
	): Promise<MarfProofResponse | null> => {
		const key = `${path}@${tip}`;
		if (!(key in this.marf)) throw new Error(`no recorded MARF proof ${key}`);
		const data = this.marf[key];
		const proof = this.marfProofs.get(key);
		if (data == null || !proof) return null;
		return { data, proof };
	};

	getWitness = async (id: string): Promise<Bytes> => {
		const w = this.witnesses.get(id);
		if (!w) throw new Error(`no recorded witness ${id}`);
		return w;
	};

	getBurnPreimage = async (ch: string): Promise<BurnPreimage> => {
		const b = this.burn[ch];
		if (!b) throw new Error(`no recorded burn preimage ${ch}`);
		return { preimage: unhex(b.preimage), burnHeight: b.burn_height };
	};

	getBitcoinHeaders = async (from: number): Promise<string[]> => {
		throw new Error(`no recorded Bitcoin headers at ${from}`);
	};

	getStateWrites = async (height: number): Promise<StateWrite[] | null> =>
		this.writes.get(height) ?? null;
}

/** One block of the window, as the indexer would store it. */
export interface FixtureBlock {
	height: number;
	blockId: string;
	blockHash: string;
	parentHash: string;
	timestamp: number;
	/** The source's burn height claim (below the Bitcoin checkpoint). */
	burnHeight: number;
	txs: BlockTransaction[];
	writes: StateWrite[];
}

/** The window, oldest first, from the recorded block bytes and writes. */
export function recordedWindow(source = new FakeProofSource()): FixtureBlock[] {
	const headers = new Map<string, NakamotoHeader>();
	for (const [id, raw] of source.blocks)
		headers.set(id, parseNakamotoHeader(raw));
	const byHeight = new Map(
		[...headers].map(([id, h]) => [Number(h.chainLength), id]),
	);
	const blocks: FixtureBlock[] = [];
	for (let height = FROM; height <= TO; height++) {
		const id = byHeight.get(height);
		if (!id) throw new Error(`no recorded block at ${height}`);
		const header = headers.get(id) as NakamotoHeader;
		const parent = headers.get(hex(header.parentBlockId));
		if (!parent) throw new Error(`no recorded parent of ${height}`);
		const burn = source.burn[hex(header.consensusHash)];
		if (!burn) throw new Error(`no recorded burn preimage for ${height}`);
		if (hex(blockId(header)) !== id) throw new Error(`block ${id} mislabeled`);
		blocks.push({
			height,
			blockId: id,
			blockHash: hex(signerSignatureHash(header)),
			parentHash: hex(signerSignatureHash(parent)),
			timestamp: Number(header.timestamp),
			burnHeight: burn.burn_height,
			txs: blockTransactions(source.blocks.get(id) as Bytes, header) ?? [],
			writes: source.writes.get(height) ?? [],
		});
	}
	return blocks;
}

/** A `reserve` write's map key (a contract principal) and stored uint. */
export function decodeReserveWrite(w: StateWrite): {
	token: string;
	amount: bigint;
} {
	const keyHex = w.key.split("::").at(-1) as string;
	const stored = Buffer.from(w.value_hex, "hex").toString("utf8");
	const key = deserializeCV(keyHex) as { type: string; value: string };
	// Stored map entries are `some(value)`.
	const some = deserializeCV(stored) as {
		type: string;
		value: { type: string; value: bigint };
	};
	if (some.type !== "some" || some.value.type !== "uint")
		throw new Error(`reserve write ${w.ordinal} is not some(uint)`);
	return { token: key.value, amount: some.value.value };
}
