import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	HeaderChain,
	type HeaderRule,
	HeaderValidationError,
} from "./chain.ts";
import { headerHashHex, parseHeader, serializeHeader } from "./header.ts";
import type { BlockHeader } from "./header.ts";
import { nextRetargetBits } from "./pow.ts";

const FIXTURE = join(
	import.meta.dir,
	"../../test/fixtures/bitcoin/headers-967680-970300.txt",
);

const rows = readFileSync(FIXTURE, "utf8")
	.trim()
	.split("\n")
	.map((line) => {
		const [height, hex] = line.split(" ");
		return { height: Number(height), hex: hex as string };
	});
const byHeight = new Map(rows.map((r) => [r.height, r.hex]));
const hexAt = (h: number) => byHeight.get(h) as string;

const CHECKPOINT = 967_680;
const RETARGET = 969_696;
const LAST = 970_300;

function chainFromCheckpoint(): HeaderChain {
	return HeaderChain.fromCheckpoint({
		height: CHECKPOINT,
		header: hexAt(CHECKPOINT),
	});
}

/** Headers in (from, to], fixture order. */
function range(from: number, to: number): string[] {
	return rows
		.filter((r) => r.height > from && r.height <= to)
		.map((r) => r.hex);
}

function tweak(height: number, edit: (h: BlockHeader) => void): Uint8Array {
	const header = parseHeader(hexAt(height));
	edit(header);
	return serializeHeader(header);
}

function expectRejection(
	chain: HeaderChain,
	headers: Array<string | Uint8Array>,
	height: number,
	rule: HeaderRule,
): void {
	const tipBefore = chain.tip.hash;
	let caught: unknown;
	try {
		chain.append(headers);
	} catch (err) {
		caught = err;
	}
	expect(caught).toBeInstanceOf(HeaderValidationError);
	const err = caught as HeaderValidationError;
	expect(err.rule).toBe(rule);
	expect(err.height).toBe(height);
	expect(err.message).toContain(`height ${height}`);
	expect(chain.tip.hash).toBe(tipBefore);
}

describe("HeaderChain on mainnet headers 967680..970300", () => {
	test("fixture is contiguous and complete", () => {
		expect(rows.length).toBe(LAST - CHECKPOINT + 1);
		rows.forEach((r, i) => expect(r.height).toBe(CHECKPOINT + i));
	});

	test("whole range validates from the checkpoint, across the 969696 retarget", () => {
		const chain = chainFromCheckpoint();
		chain.append(range(CHECKPOINT, LAST));
		expect(chain.tip.height).toBe(LAST);
		expect(chain.tip.hash).toBe(headerHashHex(hexAt(LAST)));
		expect(chain.headerAt(RETARGET)?.header.bits).not.toBe(
			chain.headerAt(RETARGET - 1)?.header.bits,
		);
		expect(chain.totalWork > 0n).toBe(true);
	});

	test("heightOf finds 970269 by its display hash", () => {
		const chain = chainFromCheckpoint();
		chain.append(range(CHECKPOINT, LAST));
		const hash = headerHashHex(hexAt(970_269));
		expect(chain.heightOf(hash)).toBe(970_269);
		expect(chain.heightOf(hash.toUpperCase())).toBe(970_269);
		expect(chain.headerAt(970_269)?.hash).toBe(hash);
		expect(chain.heightOf("00".repeat(32))).toBeUndefined();
	});

	test("computed retarget bits at 969696 equal the real header's bits", () => {
		const first = parseHeader(hexAt(RETARGET - 2016));
		const last = parseHeader(hexAt(RETARGET - 1));
		const real = parseHeader(hexAt(RETARGET));
		expect(nextRetargetBits(last.bits, first.time, last.time)).toBe(real.bits);
	});

	test("total work is the sum of per-header work and grows monotonically", () => {
		const chain = chainFromCheckpoint();
		const atCheckpoint = chain.totalWork;
		chain.append(range(CHECKPOINT, CHECKPOINT + 1));
		expect(chain.totalWork).toBe(atCheckpoint * 2n);
	});

	test("bad nonce fails proof-of-work", () => {
		const chain = chainFromCheckpoint();
		const bad = tweak(967_700, (h) => {
			h.nonce = (h.nonce + 1) >>> 0;
		});
		expectRejection(
			chain,
			[...range(CHECKPOINT, 967_699), bad],
			967_700,
			"proof-of-work",
		);
		expect(chain.tip.height).toBe(CHECKPOINT);
	});

	test("broken prev link is rejected", () => {
		const chain = chainFromCheckpoint();
		chain.append(range(CHECKPOINT, 967_699));
		const bad = tweak(967_700, (h) => {
			h.prevHash = `${"0".repeat(63)}1`;
		});
		expectRejection(chain, [bad], 967_700, "prev-link");
	});

	test("skipping a header is a broken prev link", () => {
		const chain = chainFromCheckpoint();
		expectRejection(
			chain,
			[hexAt(CHECKPOINT + 2)],
			CHECKPOINT + 1,
			"prev-link",
		);
	});

	test("re-appending a known header is rejected as a fork", () => {
		const chain = chainFromCheckpoint();
		chain.append(range(CHECKPOINT, 967_690));
		let caught: unknown;
		try {
			chain.append([hexAt(967_685)]);
		} catch (err) {
			caught = err;
		}
		expect((caught as HeaderValidationError).rule).toBe("prev-link");
		expect((caught as Error).message).toContain(
			"forks/reorgs are not supported",
		);
	});

	test("unchanged bits at the retarget height are rejected", () => {
		const chain = chainFromCheckpoint();
		chain.append(range(CHECKPOINT, RETARGET - 1));
		const bad = tweak(RETARGET, (h) => {
			h.bits = parseHeader(hexAt(RETARGET - 1)).bits;
		});
		expectRejection(chain, [bad], RETARGET, "retarget");
	});

	test("changed bits mid-period are rejected", () => {
		const chain = chainFromCheckpoint();
		const bad = tweak(967_700, (h) => {
			h.bits = 0x1d00ffff;
		});
		expectRejection(
			chain,
			[...range(CHECKPOINT, 967_699), bad],
			967_700,
			"bits",
		);
	});

	test("timestamp equal to median-time-past is rejected", () => {
		const chain = chainFromCheckpoint();
		chain.append(range(CHECKPOINT, 967_699));
		const prevTimes = range(967_688, 967_699)
			.map((hex) => parseHeader(hex).time)
			.sort((a, b) => a - b);
		const mtp = prevTimes[5] as number;
		const bad = tweak(967_700, (h) => {
			h.time = mtp;
		});
		expectRejection(chain, [bad], 967_700, "median-time-past");
	});

	test("pre-BIP65 version is rejected", () => {
		const chain = chainFromCheckpoint();
		const bad = tweak(CHECKPOINT + 1, (h) => {
			h.version = 3;
		});
		expectRejection(chain, [bad], CHECKPOINT + 1, "version");
	});

	test("checkpoint inside a period requires periodStartTime", () => {
		expect(() =>
			HeaderChain.fromCheckpoint({ height: 967_700, header: hexAt(967_700) }),
		).toThrow(HeaderValidationError);
	});

	test("mid-period checkpoint with periodStartTime validates through the retarget", () => {
		const chain = HeaderChain.fromCheckpoint({
			height: 969_000,
			header: hexAt(969_000),
			periodStartTime: parseHeader(hexAt(CHECKPOINT)).time,
		});
		chain.append(range(969_000, LAST));
		expect(chain.tip.height).toBe(LAST);
	});

	test("mid-period checkpoint with a wrong periodStartTime fails the retarget", () => {
		const chain = HeaderChain.fromCheckpoint({
			height: 969_000,
			header: hexAt(969_000),
			periodStartTime: parseHeader(hexAt(CHECKPOINT)).time - 86_400,
		});
		expectRejection(chain, range(969_000, LAST), RETARGET, "retarget");
	});
});
