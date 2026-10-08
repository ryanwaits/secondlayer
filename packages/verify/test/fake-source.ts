// A ProofSource over the test fixtures that logs every request. All data is
// mainnet; tests swap single methods to model a lying source.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	type BurnPreimage,
	type MarfProofResponse,
	type ProofSource,
	parseNakamotoHeader,
	unhex,
} from "../src/index.ts";
import {
	type BurnFixture,
	type ProofFixture,
	type SignerChainFixture,
	headerFile,
	listFixtures,
	readJson,
} from "./fixtures.ts";

const DIR = join(import.meta.dir, "fixtures");

export const BITCOIN_FROM = 967680;
export const bitcoinHeaders: string[] = readFileSync(
	join(DIR, "bitcoin", "headers-967680-970300.txt"),
	"utf8",
)
	.trim()
	.split("\n")
	.map((l) => l.split(" ")[1] as string);

export const signerChain = readJson<SignerChainFixture>(
	"signers/signer-chain.json",
);
export const burn970269 = readJson<BurnFixture>("burn/preimage-970269.json");

export interface FakeOptions {
	/** Block ids the fake also serves by height: the first one at or above the asked height. */
	heights?: string[];
	/**
	 * Burn heights for consensus hashes the fixtures hold no sortition
	 * preimage for, served with an empty preimage: a search hint, never a
	 * burn binding.
	 */
	burnHints?: Record<string, number>;
	witnesses?: Record<string, Uint8Array>;
}

export class FakeSource implements ProofSource {
	readonly log: string[] = [];
	/** Fixture header bytes by block id (file names are the ids; header.test checks them). */
	readonly blocks = new Map<string, Uint8Array>(
		readdirSync(join(DIR, "headers")).map((f) => {
			const id = f.replace(/\.bin$/, "");
			return [id, headerFile(id)];
		}),
	);
	readonly byHeight: [number, string][];
	readonly marf = new Map<string, MarfProofResponse>();
	readonly preimages = new Map<string, BurnPreimage>();
	readonly witnesses: Map<string, Uint8Array>;

	constructor(opts: FakeOptions = {}) {
		this.byHeight = (opts.heights ?? [])
			.map((id): [number, string] => [
				Number(
					parseNakamotoHeader(this.blocks.get(id) as Uint8Array).chainLength,
				),
				id,
			])
			.sort((a, b) => a[0] - b[0]);
		for (const s of Object.values(signerChain.sets))
			this.marf.set(`${s.path}@${s.at}`, {
				data: s.data,
				proof: unhex(s.proof),
			});
		for (const f of listFixtures("proofs")) {
			const p = readJson<ProofFixture>(`proofs/${f}`);
			this.marf.set(`${p.path}@${p.tip}`, {
				data: p.data,
				proof: unhex(p.proof),
			});
		}
		this.preimages.set(burn970269.consensus_hash, {
			preimage: unhex(burn970269.preimage),
			burnHeight: burn970269.burn_height,
		});
		for (const [ch, burnHeight] of Object.entries(opts.burnHints ?? {}))
			this.preimages.set(ch, { preimage: new Uint8Array(), burnHeight });
		this.witnesses = new Map(Object.entries(opts.witnesses ?? {}));
	}

	getBlock = async (ref: string | number): Promise<Uint8Array> => {
		this.log.push(`block ${ref}`);
		const id =
			typeof ref === "string"
				? ref
				: this.byHeight.find(([h]) => h >= ref)?.[1];
		const raw = id && this.blocks.get(id);
		if (!raw) throw new Error(`no fixture block ${ref}`);
		return raw;
	};

	getMarfProof = async (pathHex: string, tipId: string) => {
		this.log.push(`marf ${pathHex}@${tipId}`);
		return this.marf.get(`${pathHex}@${tipId}`) ?? null;
	};

	getWitness = async (id: string): Promise<Uint8Array> => {
		this.log.push(`witness ${id}`);
		const w = this.witnesses.get(id);
		if (!w) throw new Error(`no witness fixture for ${id}`);
		return w;
	};

	getBurnPreimage = async (ch: string): Promise<BurnPreimage> => {
		this.log.push(`burn ${ch}`);
		const bp = this.preimages.get(ch);
		if (!bp) throw new Error(`no sortition fixture for ${ch}`);
		return bp;
	};

	getBitcoinHeaders = async (from: number, count: number) => {
		this.log.push(`bitcoin ${from}+${count}`);
		const at = from - BITCOIN_FROM;
		return bitcoinHeaders.slice(at, at + count);
	};
}
