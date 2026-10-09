// A ProofSource over the test fixtures that logs every request. All data is
// mainnet; tests swap single methods to model a lying source.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	type BurnPreimage,
	type Epoch2HeaderResponse,
	type MarfProofResponse,
	type ProofSource,
	parseNakamotoHeader,
	unhex,
} from "../src/index.ts";
import {
	type BurnFixture,
	type ProofFixture,
	type SignerChainFixture,
	epoch2File,
	epoch2Ids,
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
}

/** Witnesses the prod node's MARF yields for H (9,137,005) and its parent, by block id. */
const e2eWitnesses = () =>
	new Map(
		readdirSync(join(DIR, "e2e"))
			.filter((f) => f.endsWith(".witness"))
			.map((f): [string, Uint8Array] => [
				f.replace(/\.witness$/, ""),
				new Uint8Array(readFileSync(join(DIR, "e2e", f))),
			]),
	);

export class FakeSource implements ProofSource {
	readonly log: string[] = [];
	/** Fixture header bytes by block id (file names are the ids; header.test checks them). */
	readonly blocks = new Map<string, Uint8Array>(
		readdirSync(join(DIR, "headers")).map((f) => {
			const id = f.replace(/\.bin$/, "");
			return [id, headerFile(id)];
		}),
	);
	/** Mainnet epoch 2.x headers by block id, as node `/v2/headers` serves them. */
	readonly epoch2 = new Map<string, Epoch2HeaderResponse>(
		epoch2Ids().map((id) => {
			const f = epoch2File(id);
			return [
				id,
				{ header: unhex(f.header), consensusHash: unhex(f.consensus_hash) },
			];
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
		for (const f of listFixtures("burn")) {
			const b = readJson<BurnFixture>(`burn/${f}`);
			this.preimages.set(b.consensus_hash, {
				preimage: unhex(b.preimage),
				burnHeight: b.burn_height,
			});
		}
		this.witnesses = e2eWitnesses();
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

	getEpoch2Header = async (id: string): Promise<Epoch2HeaderResponse> => {
		this.log.push(`epoch2 ${id}`);
		const h = this.epoch2.get(id);
		if (!h) throw new Error(`no epoch 2.x fixture ${id}`);
		return h;
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
