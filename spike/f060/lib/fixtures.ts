// f060 SPIKE — synthetic block/tx/event fixtures.
//
// D1/D2 do not have a live chain locally (blocks/transactions/events are empty
// in the dev DB — verified before writing this). So handler *input* (the
// MatchedTx batch the runner dispatches) is synthesized here, matching the
// exact shapes `runHandlers`/`buildEventPayload` expect
// (packages/subgraphs/src/runtime/{runner,source-matcher}.ts). Everything
// downstream of that input — SubgraphContext, runHandlers, the SQL the flush
// emits — is the real, unmodified product code. This is a component-level
// measurement, not an end-to-end one; see the D1 report header.
import { resolve } from "node:path";
import type {
	BlockMeta,
	TxMeta,
} from "../../../packages/subgraphs/src/runtime/context.ts";
import type { MatchedTx } from "../../../packages/subgraphs/src/runtime/source-matcher.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const stacksClarityPath = resolve(
	REPO_ROOT,
	"packages/stacks/src/clarity/index.ts",
);
const { serializeCV, uintCV, standardPrincipalCV } = await import(
	stacksClarityPath
);

export function blockMeta(height: number): BlockMeta {
	return {
		height,
		hash: `0x${height.toString(16).padStart(64, "0")}`,
		timestamp: 1_700_000_000 + height,
		burnBlockHeight: Math.floor(height / 10) + 800_000,
	};
}

export function txMeta(txId: string, sender: string): TxMeta {
	return { txId, sender, type: "contract_call", status: "success" };
}

/** A real hex-encoded Clarity uint, for handlers that decode function_args. */
export function clarityUintHex(value: number | bigint): string {
	return serializeCV(uintCV(value));
}

/** A real hex-encoded Clarity standard-principal, ditto. */
export function clarityPrincipalHex(address: string): string {
	return serializeCV(standardPrincipalCV(address));
}

// Real, checksum-valid mainnet Stacks addresses (pulled from existing test
// fixtures under packages/subgraphs/test — c32check validates the checksum,
// so a made-up address throws in standardPrincipalCV).
const SP_ADDRS = [
	"SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM",
	"SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6",
	"SP21G4FA7NS9YXEH2B4X8B642ZSVP7J8RB6DEVK2Y",
	"SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
];

/** Deterministic pseudo-random principal from an index (no crypto needed). */
export function principalFor(i: number): string {
	// biome-ignore lint/style/noNonNullAssertion: SP_ADDRS is a fixed non-empty array
	return SP_ADDRS[i % SP_ADDRS.length]!;
}

/** Globally-unique tx_id across the whole synthetic run — block height folded
 *  in so blocks never collide on the tables' `uniqueKeys: [["tx_id"]]`.
 *  Exported so D2's fixtures (host.ts) can build matching txIds. */
export function syntheticTxId(blockHeight: number, txIndex: number): string {
	const n = BigInt(blockHeight) * 100_000n + BigInt(txIndex);
	return `0x${n.toString(16).padStart(64, "0")}`;
}

/**
 * Build one `contract_call`-shaped MatchedTx (no events — mirrors how
 * `examples/sales-index/subgraph.ts`'s "sale" source matches: a bare
 * contract_call filter with no event requirement). `functionArgs` are real
 * hex-encoded Clarity values so `decodeFunctionArgs` in runner.ts exercises
 * its real decode path, not a stub.
 */
export function contractCallMatch(opts: {
	blockHeight: number;
	txIndex: number;
	sourceName: string;
	contractId: string;
	functionName: string;
	sender: string;
	functionArgs: string[];
}): MatchedTx {
	return {
		sourceName: opts.sourceName,
		events: [],
		tx: {
			tx_id: syntheticTxId(opts.blockHeight, opts.txIndex),
			type: "contract_call",
			sender: opts.sender,
			status: "success",
			tx_index: opts.txIndex,
			contract_id: opts.contractId,
			function_name: opts.functionName,
			function_args: JSON.stringify(opts.functionArgs),
			raw_result: null,
		},
	};
}

/** A `contract_deploy`-shaped MatchedTx (no events, no function_args). */
export function contractDeployMatch(opts: {
	blockHeight: number;
	txIndex: number;
	sourceName: string;
	contractId: string;
	deployer: string;
}): MatchedTx {
	return {
		sourceName: opts.sourceName,
		events: [],
		tx: {
			tx_id: syntheticTxId(opts.blockHeight, opts.txIndex),
			type: "smart_contract",
			sender: opts.deployer,
			status: "success",
			tx_index: opts.txIndex,
			contract_id: opts.contractId,
			function_name: null,
		},
	};
}

/**
 * A generic tx-level `contract_call` match with empty function_args. Goes
 * through the real `buildEventPayload` "contract_call, no event" arm
 * (runner.ts:162-175) same as any real match; `args`/`input` just come back
 * empty. Used by the synthetic accumulator handlers, which only need
 * `ctx.tx.sender` + a deterministic per-event key, not decoded Clarity args.
 */
export function bareMatch(opts: {
	blockHeight: number;
	txIndex: number;
	sourceName: string;
	sender: string;
}): MatchedTx {
	return {
		sourceName: opts.sourceName,
		events: [],
		tx: {
			tx_id: syntheticTxId(opts.blockHeight, opts.txIndex),
			type: "contract_call",
			sender: opts.sender,
			status: "success",
			tx_index: opts.txIndex,
			contract_id: null,
			function_name: null,
		},
	};
}
