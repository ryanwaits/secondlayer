import { describe, expect, test } from "bun:test";
import {
	BlockVerifier,
	NodeRpcProofSource,
	type ProofSource,
	SecondlayerProofSource,
} from "../src/index.ts";

// Mainnet blocks below MAINNET_CHECKPOINT (8,956,304), against live sources.
// Off unless VERIFY_LIVE_API_KEY is set. VERIFY_LIVE_NODE_URL (optional) serves
// blocks, 2.x headers and MARF proofs from a node instead of the API.
//
// Blocks more than 16 below a trusted block need a MARF proof of
// `__MARF_BLOCK_HEIGHT_TO_HASH::<height>`. A stock node cannot serve one
// (`/v2/clarity/marf` answers only keys with a stored value string), so those
// cases fail at `ancestry` with `unavailable` until the source can.
const API_KEY = process.env.VERIFY_LIVE_API_KEY;
const API_URL =
	process.env.VERIFY_LIVE_API_URL ?? "https://api.secondlayer.tools";
const NODE_URL = process.env.VERIFY_LIVE_NODE_URL;

function liveSource(): ProofSource {
	const api = new SecondlayerProofSource({
		baseUrl: API_URL,
		apiKey: API_KEY ?? "",
	});
	return NODE_URL
		? { ...api, ...new NodeRpcProofSource({ nodeUrl: NODE_URL }) }
		: api;
}

describe.if(Boolean(API_KEY))("verifyBlock below the checkpoint (live)", () => {
	test("8,956,301: three parent links from the checkpoint", async () => {
		const r = await new BlockVerifier({ source: liveSource() }).verify(8956301);
		expect(r.failures).toEqual([]);
		expect(r.ancestry?.via).toBe("parents");
	}, 60_000);

	test("1,113,075 (Nakamoto): one MARF proof from the checkpoint", async () => {
		const r = await new BlockVerifier({ source: liveSource() }).verify(1113075);
		expect(r.failures).toEqual([]);
		expect(r).toMatchObject({
			blockId:
				"4cfffc0ee473d431f919093528e785ebb59813967ce49385c9c3e73cfc0596c0",
			ancestry: { via: "marf" },
		});
	}, 120_000);

	test("150,000 (epoch 2.x): one MARF proof, then the 2.x header", async () => {
		const r = await new BlockVerifier({ source: liveSource() }).verify(150000);
		expect(r.failures).toEqual([]);
		expect(r).toMatchObject({
			blockId:
				"7172a926a42a9356074c71facea8c6450398c97d717fd900884af2bb9102ffa1",
			ancestry: { via: "marf" },
		});
	}, 120_000);
});
