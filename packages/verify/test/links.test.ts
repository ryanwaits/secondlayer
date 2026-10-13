import { describe, expect, test } from "bun:test";
import {
	LINKS,
	type VerifyCheckpoint,
	blockId,
	describeLinks,
	hex,
	marfPath,
	unhex,
	verifyBlock,
} from "../src/index.ts";
import { heightToHashKey } from "../src/marf.ts";
import { FakeSource, signerChain } from "./fake-source.ts";
import {
	CHECKPOINT_143,
	type WitnessFixture,
	epoch2File,
	readJson,
} from "./fixtures.ts";
import { buildHeightProof } from "./marf-builder.ts";

const H = signerChain.h;
const B2000 =
	"113e01ba3dd3e340af346d641e79887628e318e10f259eda0a692bed9f9d2f31";
const ANCESTOR = epoch2File(
	"7172a926a42a9356074c71facea8c6450398c97d717fd900884af2bb9102ffa1",
);

const statuses = (lines: { label: string; status: string }[]) =>
	Object.fromEntries(lines.map((l) => [l.label, l.status]));

describe("describeLinks", () => {
	test("a proven block lists every link in verifier order and ends on the proven verdict", async () => {
		const source = new FakeSource({
			heights: [signerChain.checkpoint, signerChain.a, H],
		});
		const result = await verifyBlock(9137005, {
			checkpoint: CHECKPOINT_143,
			source,
		});
		const { lines, verdict } = describeLinks(result, CHECKPOINT_143);
		expect(lines.map((l) => l.label)).toEqual(
			LINKS.filter((l) => l.step !== "ancestry").map((l) => l.label),
		);
		// The fixture is the header alone, so there are no transaction bytes.
		expect(statuses(lines)).toEqual({
			block: "ok",
			bitcoin: "ok",
			burn: "ok",
			cycle: "ok",
			signatures: "ok",
			txs: "skipped",
			"state root": "ok",
			diff: "ok",
			rows: "skipped",
		});
		expect(lines.find((l) => l.label === "rows")?.detail).toBe(
			"not checked (pass --rows)",
		);
		expect(verdict).toEqual({
			ok: true,
			text: "Block 9,137,005 is proven. Trusted: only the checkpoint (Stacks 8,956,304, Bitcoin 967,680).",
		});
	});

	test("the first broken link fails, the links after it are skipped, and the verdict names it", async () => {
		const source = new FakeSource({
			heights: [signerChain.checkpoint, signerChain.a, H],
		});
		const other = readJson<WitnessFixture>("witness/witness-264.json");
		source.witnesses.set(H, unhex(other.witness));
		const result = await verifyBlock(9137005, {
			checkpoint: CHECKPOINT_143,
			source,
		});
		const { lines, verdict } = describeLinks(result, CHECKPOINT_143);
		const witness = lines.find((l) => l.label === "state root");
		expect(witness?.status).toBe("failed");
		expect(witness?.detail).toBe(result.failures[0]?.message);
		const diff = lines.find((l) => l.label === "diff");
		expect(diff).toMatchObject({
			status: "skipped",
			detail: "not checked: an earlier link is broken",
		});
		expect(verdict).toEqual({
			ok: false,
			text: "Not proven: the state root link is broken.",
		});
	});

	test("a source that cannot serve a link says so instead of calling the block unproven", async () => {
		const source = new FakeSource({
			heights: [signerChain.checkpoint, signerChain.a, H],
		});
		source.getBitcoinHeaders = async () => {
			throw new Error("connection refused");
		};
		const result = await verifyBlock(9137005, {
			checkpoint: CHECKPOINT_143,
			source,
		});
		const { lines, verdict } = describeLinks(result, CHECKPOINT_143);
		expect(lines.find((l) => l.label === "bitcoin")?.status).toBe("failed");
		expect(verdict).toEqual({
			ok: false,
			text: "Could not check the bitcoin link: the source could not serve it.",
		});
	});

	test("a block below the checkpoint adds its ancestry link and skips the links it does not need", async () => {
		const p = buildHeightProof({
			height: 2000,
			id: B2000,
			tipBytes: unhex(CHECKPOINT_143.stacks.header),
			ancestorBytes: unhex(ANCESTOR.header),
			ancestorCh: unhex(ANCESTOR.consensus_hash),
		});
		const source = new FakeSource();
		source.marf.set(
			`${hex(marfPath(heightToHashKey(2000)))}@${hex(blockId(p.tipHeader))}`,
			{ data: "", proof: p.proof },
		);
		source.epoch2.set(p.ancestorId, p.ancestor);
		const checkpoint: VerifyCheckpoint = {
			...CHECKPOINT_143,
			stacks: { ...CHECKPOINT_143.stacks, header: hex(p.tip) },
		};
		const result = await verifyBlock(2000, { source, checkpoint });
		const { lines, verdict } = describeLinks(result, checkpoint);
		expect(lines[0]).toMatchObject({
			label: "ancestry",
			status: "ok",
			detail:
				"2,000 proven in the state of the checkpoint 8,956,304 (one MARF proof)",
		});
		for (const label of ["bitcoin", "burn", "cycle", "signatures"])
			expect(lines.find((l) => l.label === label)).toMatchObject({
				status: "skipped",
				detail: "not needed: the block is hash-chained to the checkpoint",
			});
		expect(verdict.ok).toBe(true);
	});
});
