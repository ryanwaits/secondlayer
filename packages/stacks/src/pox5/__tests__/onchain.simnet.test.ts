import { beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Simnet, initSimnet } from "@stacks/clarinet-sdk";
import { getContract } from "../../actions/getContract.ts";
import type { AbiContract } from "../../clarity/abi/contract.ts";
import { createPublicClient } from "../../clients/createPublicClient.ts";
import { simnet, simnetChain } from "../../simnet/index.ts";
import { bytesToHex } from "../../utils/encoding.ts";
import { computeSignerGrantHash } from "../grants.ts";
import {
	buildDefaultStakerUnlockBytes,
	buildLockupOutputScript,
	buildLockupScript,
	pushCScriptNum,
	serializeCScriptNum,
} from "../script.ts";

const MANIFEST = resolve(
	import.meta.dir,
	"../../../../../contracts/Clarinet.toml",
);
const POX5_ADDRESS = "SP000000000000000000002Q6VF78";
const POX5_NAME = "pox-5";

/** Subset of pox-5 used by the off-chain script/grant ports — not the curated wallet ABI. */
const POX5_SCRIPT_ABI = {
	functions: [
		{
			name: "serialize-c-script-num",
			access: "read-only",
			args: [{ name: "n", type: "uint128" }],
			outputs: {
				response: { ok: { buff: { length: 16 } }, error: "uint128" },
			},
		},
		{
			name: "push-c-script-num",
			access: "read-only",
			args: [{ name: "n", type: "uint128" }],
			outputs: {
				response: { ok: { buff: { length: 16 } }, error: "uint128" },
			},
		},
		{
			name: "construct-lockup-script",
			access: "read-only",
			args: [
				{ name: "staker", type: "principal" },
				{ name: "unlock-burn-height", type: "uint128" },
				{ name: "staker-unlock-bytes", type: { buff: { length: 34 } } },
				{ name: "early-unlock-bytes", type: { buff: { length: 683 } } },
			],
			outputs: {
				response: { ok: { buff: { length: 1024 } }, error: "uint128" },
			},
		},
		{
			name: "construct-lockup-output-script",
			access: "read-only",
			args: [
				{ name: "staker", type: "principal" },
				{ name: "unlock-burn-height", type: "uint128" },
				{ name: "staker-unlock-bytes", type: { buff: { length: 34 } } },
				{ name: "early-unlock-bytes", type: { buff: { length: 683 } } },
			],
			outputs: {
				response: { ok: { buff: { length: 1024 } }, error: "uint128" },
			},
		},
		{
			name: "get-signer-grant-message-hash",
			access: "read-only",
			args: [
				{ name: "signer-manager", type: "principal" },
				{ name: "auth-id", type: "uint128" },
			],
			outputs: { buff: { length: 32 } },
		},
	],
} as const satisfies AbiContract;

let session: Simnet;
let pox5: ReturnType<typeof getContract<typeof POX5_SCRIPT_ABI>>;

beforeAll(async () => {
	session = await initSimnet(MANIFEST);
	const client = createPublicClient({
		chain: simnetChain,
		transport: simnet(session),
	});
	pox5 = getContract({
		client,
		address: POX5_ADDRESS,
		name: POX5_NAME,
		abi: POX5_SCRIPT_ABI,
	});
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

	test("serialize-c-script-num", async () => {
		for (const n of CASES) {
			const onchain = await pox5.read.serializeCScriptNum({ n });
			expect(bytesToHex(onchain)).toBe(bytesToHex(serializeCScriptNum(n)));
		}
	});

	test("push-c-script-num (incl. OP_0/OP_1..16 fast path)", async () => {
		for (const n of [0n, ...CASES]) {
			const onchain = await pox5.read.pushCScriptNum({ n });
			expect(bytesToHex(onchain)).toBe(bytesToHex(pushCScriptNum(n)));
		}
	});
});

describe("lockup script construction matches the boot contract", () => {
	const STAKER = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
	const CONTRACT_STAKER = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.my-vault";
	const UNLOCK_HEIGHT = 960_230n + 25_200n;
	const STAKER_UNLOCK = buildDefaultStakerUnlockBytes(`02${"11".repeat(32)}`);
	const EARLY_UNLOCK = new Uint8Array([0x21, ...Array(33).fill(0x22), 0xac]);

	for (const [label, staker] of [
		["standard principal", STAKER],
		["contract principal", CONTRACT_STAKER],
	] as const) {
		test(`construct-lockup-script — ${label}`, async () => {
			const onchain = await pox5.read.constructLockupScript({
				staker,
				unlockBurnHeight: UNLOCK_HEIGHT,
				stakerUnlockBytes: STAKER_UNLOCK,
				earlyUnlockBytes: EARLY_UNLOCK,
			});
			const ours = buildLockupScript({
				stxAddress: staker,
				unlockBurnHeight: UNLOCK_HEIGHT,
				stakerUnlockBytes: STAKER_UNLOCK,
				earlyUnlockBytes: EARLY_UNLOCK,
			});
			expect(bytesToHex(onchain)).toBe(bytesToHex(ours));
		});
	}

	test("construct-lockup-output-script (p2wsh scriptPubKey)", async () => {
		const onchain = await pox5.read.constructLockupOutputScript({
			staker: STAKER,
			unlockBurnHeight: UNLOCK_HEIGHT,
			stakerUnlockBytes: STAKER_UNLOCK,
			earlyUnlockBytes: EARLY_UNLOCK,
		});
		const ours = buildLockupOutputScript({
			stxAddress: STAKER,
			unlockBurnHeight: UNLOCK_HEIGHT,
			stakerUnlockBytes: STAKER_UNLOCK,
			earlyUnlockBytes: EARLY_UNLOCK,
		});
		expect(bytesToHex(onchain)).toBe(bytesToHex(ours));
	});
});

describe("signer-grant hash matches the boot contract", () => {
	test("get-signer-grant-message-hash", async () => {
		const signerManager =
			"SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.signer-mgr";
		const authId = 42n;
		const onchain = await pox5.read.getSignerGrantMessageHash({
			signerManager,
			authId,
		});

		const mainnet = bytesToHex(
			computeSignerGrantHash({ signerManager, authId, chainId: 0x00000001 }),
		);
		const testnet = bytesToHex(
			computeSignerGrantHash({ signerManager, authId, chainId: 0x80000000 }),
		);
		expect([mainnet, testnet]).toContain(bytesToHex(onchain));
	});
});
