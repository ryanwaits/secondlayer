import { beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Simnet, initSimnet } from "@stacks/clarinet-sdk";
import {
	type ClarityValue as StacksCV,
	Cl as StacksCl,
} from "@stacks/transactions";
import {
	type ClarityValue,
	deserializeCV,
	serializeCV,
} from "../../clarity/index.ts";
import { Cl } from "../../clarity/values.ts";
import { bytesToHex } from "../../utils/encoding.ts";
import { computeSignerGrantHash } from "../grants.ts";
import {
	buildDefaultStakerUnlockBytes,
	buildLockupOutputScript,
	buildLockupScript,
	pushCScriptNum,
	serializeCScriptNum,
} from "../script.ts";

// Byte-compares the SDK's pox-5 ports against the ACTUAL boot contract in
// Clarinet simnet (Epoch 4.0 ships pox-5). If these pass, the bytes we build
// off-chain are exactly what the deployed contract computes on-chain.

const MANIFEST = resolve(
	import.meta.dir,
	"../../../../../contracts/Clarinet.toml",
);
const POX5 = "SP000000000000000000002Q6VF78.pox-5";

const toChain = (cv: ClarityValue): StacksCV =>
	StacksCl.deserialize(serializeCV(cv));
const fromChain = (cv: StacksCV): ClarityValue =>
	deserializeCV(StacksCl.serialize(cv));

let simnet: Simnet;
let deployer: string;

const callRO = (method: string, args: ClarityValue[]): ClarityValue =>
	fromChain(
		simnet.callReadOnlyFn(POX5, method, args.map(toChain), deployer).result,
	);

/** Unwrap an (ok (buff …)) result to hex (our BufferCV stores hex). */
function okBuffHex(cv: ClarityValue): string {
	expect(cv.type).toBe("ok");
	// biome-ignore lint/suspicious/noExplicitAny: test unwrap of known response shape
	const inner = (cv as any).value;
	expect(inner.type).toBe("buffer");
	return inner.value as string;
}

beforeAll(async () => {
	simnet = await initSimnet(MANIFEST);
	deployer = simnet.getAccounts().get("deployer") as string;
});

describe("script-number ports match the boot contract", () => {
	const CASES = [
		1n,
		2n,
		16n,
		17n,
		127n,
		128n,
		255n,
		256n,
		65_535n,
		960_230n,
		499_999_999n,
		549_755_813_887n,
	];

	test("serialize-c-script-num", () => {
		for (const n of CASES) {
			const onchain = okBuffHex(callRO("serialize-c-script-num", [Cl.uint(n)]));
			expect(bytesToHex(serializeCScriptNum(n))).toBe(onchain);
		}
	});

	test("push-c-script-num (incl. OP_0/OP_1..16 fast path)", () => {
		for (const n of [0n, ...CASES]) {
			const onchain = okBuffHex(callRO("push-c-script-num", [Cl.uint(n)]));
			expect(bytesToHex(pushCScriptNum(n))).toBe(onchain);
		}
	});
});

describe("lockup script construction matches the boot contract", () => {
	const STAKER = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
	const CONTRACT_STAKER = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.my-vault";
	const UNLOCK_HEIGHT = 960_230 + 25_200; // activation + 12 cycles
	const STAKER_UNLOCK = buildDefaultStakerUnlockBytes(`02${"11".repeat(32)}`);
	// An arbitrary per-bond early-unlock subscript (opaque to the SDK).
	const EARLY_UNLOCK = new Uint8Array([0x21, ...Array(33).fill(0x22), 0xac]);

	for (const [label, staker] of [
		["standard principal", STAKER],
		["contract principal", CONTRACT_STAKER],
	] as const) {
		test(`construct-lockup-script — ${label}`, () => {
			const onchain = okBuffHex(
				callRO("construct-lockup-script", [
					Cl.principal(staker),
					Cl.uint(UNLOCK_HEIGHT),
					Cl.buffer(STAKER_UNLOCK),
					Cl.buffer(EARLY_UNLOCK),
				]),
			);
			const ours = buildLockupScript({
				stxAddress: staker,
				unlockBurnHeight: UNLOCK_HEIGHT,
				stakerUnlockBytes: STAKER_UNLOCK,
				earlyUnlockBytes: EARLY_UNLOCK,
			});
			expect(bytesToHex(ours)).toBe(onchain);
		});
	}

	test("construct-lockup-output-script (p2wsh scriptPubKey)", () => {
		const onchain = okBuffHex(
			callRO("construct-lockup-output-script", [
				Cl.principal(STAKER),
				Cl.uint(UNLOCK_HEIGHT),
				Cl.buffer(STAKER_UNLOCK),
				Cl.buffer(EARLY_UNLOCK),
			]),
		);
		const ours = buildLockupOutputScript({
			stxAddress: STAKER,
			unlockBurnHeight: UNLOCK_HEIGHT,
			stakerUnlockBytes: STAKER_UNLOCK,
			earlyUnlockBytes: EARLY_UNLOCK,
		});
		expect(bytesToHex(ours)).toBe(onchain);
	});
});

describe("signer-grant hash matches the boot contract", () => {
	test("get-signer-grant-message-hash", () => {
		const signerManager =
			"SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.signer-mgr";
		const authId = 42n;
		const onchainCv = callRO("get-signer-grant-message-hash", [
			Cl.principal(signerManager),
			Cl.uint(authId),
		]);
		expect(onchainCv.type).toBe("buffer");
		// biome-ignore lint/suspicious/noExplicitAny: test unwrap of known buffer shape
		const onchain = (onchainCv as any).value as string;

		// Simnet's `chain-id` is one of the two well-known values; assert ours
		// matches under exactly one and record which.
		const mainnet = bytesToHex(
			computeSignerGrantHash({ signerManager, authId, chainId: 0x00000001 }),
		);
		const testnet = bytesToHex(
			computeSignerGrantHash({ signerManager, authId, chainId: 0x80000000 }),
		);
		expect([mainnet, testnet]).toContain(onchain);
	});
});
