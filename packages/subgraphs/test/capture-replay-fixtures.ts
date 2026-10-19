/**
 * Records the mainnet replay window the e2e test verifies offline.
 *
 * Verifies every block of `--from..--to` from `MAINNET_CHECKPOINT` against
 * the hosted proof routes (`/v1/proofs/*`), top first as replay does, and
 * saves every answer the verifier read: block bytes, witnesses (the parent
 * of `--from` included), the MARF ancestry proof, the epoch 2.x headers its
 * proofs cross and burn preimages. Each
 * block's `state_writes` come from `--writes <dir>` (one `<height>.json`
 * array per block, recorded once from a node that stores them); this script
 * never queries a database. `--drop H:ORDINAL` also records what the
 * verifier reads to catch a source that hides that write (hidden-write).
 *
 *   SECONDLAYER_API_KEY=… bun run packages/subgraphs/test/capture-replay-fixtures.ts \
 *     --from 1230195 --to 1230205 --writes <dir> --drop 1230200:5 [--out dir]
 *
 * The key only raises the proof rate limit; it is never printed or written.
 * Witness calls are spaced 600 ms apart, every other call 250 ms.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	BlockVerifier,
	type BurnPreimage,
	type Bytes,
	type Epoch2HeaderResponse,
	MAINNET_CHECKPOINT,
	type MarfProofResponse,
	type ProofSource,
	SecondlayerProofSource,
	type StateWrite,
	hex,
	unhex,
} from "@secondlayer/verify";

function arg(name: string, def?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : def;
}

const WITNESS_GAP_MS = 600;
const GAP_MS = 250;

let last = 0;
async function spaced<T>(gap: number, call: () => Promise<T>): Promise<T> {
	const wait = last + gap - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	try {
		return await call();
	} finally {
		last = Date.now();
	}
}

/** Every answer the verifier read, keyed the way the fake source looks it up. */
interface Recording {
	blocks: Map<string, Bytes>;
	witnesses: Map<string, Bytes>;
	marf: Record<string, { data: string; proof: string } | null>;
	burn: Record<string, { preimage: string; burn_height: number }>;
	/** Pre-Nakamoto headers a MARF proof crosses, as `/v1/proofs/epoch2-header` serves them. */
	epoch2: Record<string, { header: string; consensus_hash: string }>;
}

function recorder(
	live: SecondlayerProofSource,
	writes: (height: number) => StateWrite[] | null,
	rec: Recording,
): ProofSource {
	const unexpected = (what: string) => {
		throw new Error(`the window should not need ${what}; widen the recorder`);
	};
	return {
		getBlock: async (ref) => {
			if (typeof ref === "number") return unexpected(`block by height ${ref}`);
			const known = rec.blocks.get(ref);
			if (known) return known;
			const raw = await spaced(GAP_MS, () => live.getBlock(ref));
			rec.blocks.set(ref, raw);
			return raw;
		},
		getWitness: async (id) => {
			const known = rec.witnesses.get(id);
			if (known) return known;
			const w = await spaced(WITNESS_GAP_MS, () => live.getWitness(id));
			rec.witnesses.set(id, w);
			return w;
		},
		getMarfProof: async (path, tip): Promise<MarfProofResponse | null> => {
			const key = `${path}@${tip}`;
			const known = rec.marf[key];
			if (known !== undefined)
				return known && { data: known.data, proof: unhex(known.proof) };
			const answer = await spaced(GAP_MS, () => live.getMarfProof(path, tip));
			rec.marf[key] = answer && {
				data: answer.data,
				proof: hex(answer.proof),
			};
			return answer;
		},
		getBurnPreimage: async (ch): Promise<BurnPreimage> => {
			const known = rec.burn[ch];
			if (known)
				return {
					preimage: unhex(known.preimage),
					burnHeight: known.burn_height,
				};
			const bp = await spaced(GAP_MS, () => live.getBurnPreimage(ch));
			rec.burn[ch] = {
				preimage: hex(bp.preimage),
				burn_height: bp.burnHeight,
			};
			return bp;
		},
		getBitcoinHeaders: async (from) => unexpected(`Bitcoin headers at ${from}`),
		getEpoch2Header: async (id): Promise<Epoch2HeaderResponse> => {
			const h = await spaced(GAP_MS, () => live.getEpoch2Header(id));
			rec.epoch2[id] = {
				header: hex(h.header),
				consensus_hash: hex(h.consensusHash),
			};
			return h;
		},
		getStateWrites: async (height) => writes(height),
	};
}

/** `--drop H:ORDINAL` (repeatable): record what a source hiding that write costs. */
function dropArgs(): { height: number; ordinal: number }[] {
	const out: { height: number; ordinal: number }[] = [];
	process.argv.forEach((a, i) => {
		if (a !== "--drop") return;
		const [height, ordinal] = (process.argv[i + 1] ?? "")
			.split(":")
			.map(Number);
		if (!Number.isInteger(height) || !Number.isInteger(ordinal))
			throw new Error(`--drop wants H:ORDINAL, got ${process.argv[i + 1]}`);
		out.push({ height: height as number, ordinal: ordinal as number });
	});
	return out;
}

async function main(): Promise<void> {
	const from = Number(arg("from"));
	const to = Number(arg("to"));
	const writesDir = arg("writes");
	const outDir = arg(
		"out",
		join(import.meta.dir, "fixtures", `replay-${from}`),
	) as string;
	if (
		!Number.isFinite(from) ||
		!Number.isFinite(to) ||
		to < from ||
		!writesDir
	) {
		console.error(
			"usage: bun capture-replay-fixtures.ts --from H1 --to H2 --writes <dir> [--drop H:ORDINAL] [--out dir]",
		);
		process.exit(1);
	}
	const apiKey = process.env.SECONDLAYER_API_KEY;
	if (!apiKey) {
		console.error("SECONDLAYER_API_KEY is not set");
		process.exit(1);
	}

	const writes = new Map<number, StateWrite[]>();
	for (let h = from; h <= to; h++)
		writes.set(
			h,
			JSON.parse(
				readFileSync(join(writesDir, `${h}.json`), "utf8"),
			) as StateWrite[],
		);

	const rec: Recording = {
		blocks: new Map(),
		witnesses: new Map(),
		marf: {},
		burn: {},
		epoch2: {},
	};
	const live = new SecondlayerProofSource({ apiKey });
	const source = recorder(live, (h) => writes.get(h) ?? null, rec);
	const verifier = new BlockVerifier({
		source,
		checkpoint: MAINNET_CHECKPOINT,
	});
	for (let h = to; h >= from; h--) {
		const v = await verifier.verify(h);
		if (!v.ok) {
			console.error(`block ${h} does not verify:`, v.failures);
			process.exit(1);
		}
		// Replay reads the burn height hint when the Bitcoin checkpoint is above it.
		if (v.burnHeight === undefined && v.consensusHash)
			await source.getBurnPreimage(v.consensusHash);
		console.log(
			`block ${h} ${v.blockId}: ${v.transactions?.length ?? 0} txs, ${writes.get(h)?.length ?? 0} writes`,
		);
	}

	// A source that hides one write: replay walks down from `to` again, and
	// the verifier asks the parent's MARF whether the unnamed leaf is carried.
	for (const drop of dropArgs()) {
		const lying = recorder(
			live,
			(h) =>
				writes
					.get(h)
					?.filter((w) => !(h === drop.height && w.ordinal === drop.ordinal)) ??
				null,
			rec,
		);
		const v2 = new BlockVerifier({
			source: lying,
			checkpoint: MAINNET_CHECKPOINT,
		});
		for (let h = to; h >= drop.height; h--) {
			const v = await v2.verify(h);
			if (h > drop.height ? !v.ok : v.failures[0]?.code !== "hidden-write") {
				console.error(
					`dropping ${drop.height}:${drop.ordinal}, block ${h}:`,
					v.failures,
				);
				process.exit(1);
			}
		}
		console.log(`dropping ${drop.height}:${drop.ordinal} → hidden-write`);
	}

	for (const sub of ["blocks", "witnesses", "writes"])
		mkdirSync(join(outDir, sub), { recursive: true });
	for (const [id, raw] of rec.blocks)
		writeFileSync(join(outDir, "blocks", `${id}.bin`), raw);
	for (const [id, w] of rec.witnesses)
		writeFileSync(join(outDir, "witnesses", `${id}.bin`), w);
	for (const [h, ws] of writes)
		writeFileSync(
			join(outDir, "writes", `${h}.json`),
			`${JSON.stringify(ws, null, "\t")}\n`,
		);
	// Proofs run to hundreds of KB each: bytes in marf/, values in marf.json.
	mkdirSync(join(outDir, "marf"), { recursive: true });
	const marfData: Record<string, string | null> = {};
	for (const [key, answer] of Object.entries(rec.marf)) {
		marfData[key] = answer?.data ?? null;
		if (answer)
			writeFileSync(join(outDir, "marf", `${key}.bin`), unhex(answer.proof));
	}
	writeFileSync(
		join(outDir, "marf.json"),
		`${JSON.stringify(marfData, null, "\t")}\n`,
	);
	writeFileSync(
		join(outDir, "epoch2.json"),
		`${JSON.stringify(rec.epoch2, null, "\t")}\n`,
	);
	writeFileSync(
		join(outDir, "burn.json"),
		`${JSON.stringify(rec.burn, null, "\t")}\n`,
	);
	console.log(
		`wrote ${rec.blocks.size} blocks, ${rec.witnesses.size} witnesses, ${Object.keys(rec.marf).length} MARF proofs, ${Object.keys(rec.epoch2).length} epoch 2.x headers, ${Object.keys(rec.burn).length} burn preimages → ${outDir}`,
	);
}

void main();
