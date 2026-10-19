import { OUTSPEND_SCAN_BLOCKS } from "../../bitcoin/outspend.ts";
import { OUTSPEND_RATE_LIMIT } from "../bitcoin.ts";
import {
	ERROR_401,
	ERROR_429,
	READ_SECURITY,
	json200,
	jsonError,
	pp,
} from "./shared.ts";

const TXID_EXAMPLE =
	"f80a188d012dbb733748db003b987cc98fc4a636cbd071734decb298c1bad80b";
const SPENDER_EXAMPLE =
	"3b7a6f0c2d9e1a4b5c8d7e6f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3";

export const bitcoinPaths = {
	"/v1/bitcoin/outspend/{txid}/{vout}": {
		get: {
			tags: ["bitcoin"],
			summary: "Bitcoin output spend status",
			"x-nav-title": "Output spend",
			description: `Whether one Bitcoin output is spent, and by which transaction, read live from this instance's Bitcoin node. A spend in the mempool shows on the next read, with \`mempool: true\`. A confirmed spend names its block. The spender of a confirmed spend is found by reading blocks back from the tip, up to ${OUTSPEND_SCAN_BLOCKS} of them. A spend deeper than that answers \`spent: true\` with a null \`spending_txid\` and a \`note\`. Answers can change with the mempool and with reorgs, so they are cached for 2 seconds at most. Hosted: one row per answer, ${OUTSPEND_RATE_LIMIT.limit} requests per second per key. Self-host needs Bitcoin Core 24 or later with \`txindex=1\` at \`BITCOIN_RPC_URL\`.`,
			security: READ_SECURITY,
			parameters: [
				{
					...pp(
						"txid",
						"The txid of the transaction that created the output, display order: 64 hex characters, `0x` optional.",
					),
					schema: {
						type: "string",
						pattern: "^(0x)?[0-9a-fA-F]{64}$",
						example: TXID_EXAMPLE,
					},
				},
				{
					...pp("vout", "The output's index in that transaction, from 0."),
					schema: { type: "integer", minimum: 0, example: 0 },
				},
			],
			responses: {
				"200": json200(
					{ $ref: "#/components/schemas/BitcoinOutspend" },
					"The output's spend status",
				),
				"400": jsonError(
					"The txid is not 64 hex characters, or vout is not a non-negative integer (`VALIDATION_ERROR`)",
				),
				"401": jsonError(ERROR_401),
				"404": jsonError(
					"No transaction with that txid, no output at that index, or an `OP_RETURN` output, which can never be spent",
				),
				"429": jsonError(ERROR_429),
				"502": jsonError(
					"The Bitcoin node could not be read, or lacks a method this needs (`BITCOIN_SOURCE_ERROR`)",
				),
				"503": jsonError(
					"`BITCOIN_UNAVAILABLE`: this instance has no Bitcoin node (`BITCOIN_RPC_URL` unset). `BITCOIN_BUSY`: block reads are at capacity; retry after `Retry-After` seconds",
				),
			},
		},
	},
};

export const bitcoinSchemas = {
	BitcoinOutspend: {
		type: "object",
		description:
			"One output's spend status. An unspent output carries only `txid`, `vout` and `spent`.",
		required: ["txid", "vout", "spent"],
		properties: {
			txid: {
				type: "string",
				description: "The output's transaction, display order, no `0x`.",
			},
			vout: { type: "integer", description: "The output's index." },
			spent: {
				type: "boolean",
				description:
					"True once any transaction spends it, in the mempool or in a block.",
			},
			spending_txid: {
				type: ["string", "null"],
				description:
					"The spending transaction. Null for a confirmed spend deeper than the blocks a lookup reads; `note` says so.",
			},
			spending_vin: {
				type: ["integer", "null"],
				description: "The index of the spending input in that transaction.",
			},
			confirmed: {
				type: "boolean",
				description: "True when the spend is in a block of the active chain.",
			},
			mempool: {
				type: "boolean",
				description: "True when the spend is only in the mempool so far.",
			},
			block_height: {
				type: ["integer", "null"],
				description: "Height of the block with the spend. Null in the mempool.",
			},
			block_hash: {
				type: ["string", "null"],
				description: "Hash of the block with the spend. Null in the mempool.",
			},
			note: {
				type: "string",
				description:
					"Present when the answer is incomplete: why the spender is not named.",
			},
		},
		example: {
			txid: TXID_EXAMPLE,
			vout: 0,
			spent: true,
			spending_txid: SPENDER_EXAMPLE,
			spending_vin: 0,
			confirmed: true,
			mempool: false,
			block_height: 968470,
			block_hash:
				"00000000000000000001c3b0d1a9f5e2e5b2a9c2d0f6c7e1b8a4d3c2b1a09f8e",
		},
	},
};
