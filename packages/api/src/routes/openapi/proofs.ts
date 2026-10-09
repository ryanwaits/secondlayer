import { MAX_BITCOIN_HEADERS } from "../proofs.ts";
import {
	ERROR_401,
	ERROR_429,
	READ_SECURITY,
	json200,
	jsonError,
	pp,
	qp,
} from "./shared.ts";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const INDEX_BLOCK_HASH_EXAMPLE =
	"990152a894e12288960c8b68e5790ad7994f9d261e9ad8adc13c72e76f914339";

/** Mainnet block 150,000, header shortened. */
const EPOCH2_HEADER_EXAMPLE = {
	consensus_hash: "0898651bac6711e8c7679d76bdf5ffb11e9d6f7c",
	header: "070000004b4c5f4fb400000000000249f0…",
	parent_block_id:
		"d281730546550e66a5b734c49cba0867c3e379c6d39f7e819be44c64a9c03b9f",
};

const HASH32 = {
	type: "string",
	pattern: "^(0x)?[0-9a-fA-F]{64}$",
};

const INDEX_BLOCK_HASH_PARAM = {
	...pp(
		"index_block_hash",
		"The block's `index_block_hash`: 64 hex characters, `0x` optional.",
	),
	schema: { ...HASH32, example: INDEX_BLOCK_HASH_EXAMPLE },
};

const ERROR_400_PARAM =
	"A path or query parameter is malformed (`VALIDATION_ERROR`): hashes must be exact-length hex, heights non-negative integers";
const ERROR_502 =
	"The node or proof sidecar could not be reached, or answered with an unexpected status (`PROOF_SOURCE_ERROR`)";
const ERROR_503_SIDECAR =
	"`PROOFS_UNAVAILABLE`: this instance has no proof sidecar (`PROOF_SIDECAR_URL` unset). `PROOF_SOURCE_BUSY`: the sidecar is busy; retry after `Retry-After` seconds";

function responses(
	success: Record<string, unknown>,
	notFound: string,
	opts: { sidecar?: boolean } = {},
): Record<string, unknown> {
	return {
		"200": success,
		"400": jsonError(ERROR_400_PARAM),
		"401": jsonError(ERROR_401),
		"404": jsonError(notFound),
		"429": jsonError(ERROR_429),
		"502": jsonError(ERROR_502),
		...(opts.sidecar ? { "503": jsonError(ERROR_503_SIDECAR) } : {}),
	};
}

function binary200(description: string, headers?: Record<string, unknown>) {
	return {
		description,
		...(headers ? { headers } : {}),
		content: {
			"application/octet-stream": {
				schema: { type: "string", format: "binary" },
			},
		},
	};
}

const FREE =
	"Free: never metered, never refused for credits. Bytes are passed through unchanged; verify them, do not trust them.";

export const proofsPaths = {
	"/v1/proofs/witness/{index_block_hash}": {
		get: {
			tags: ["proofs"],
			summary: "State witness for a block",
			description: `The block's MARF state witness (wire v3) from the proof sidecar: the trie nodes the block wrote, ancestor roots, and the names of every write. Recompute the root and compare it with the header's \`state_index_root\`; every changed leaf is a named write, a carried value, or an internal key, so a hidden write fails. Extracted on demand, so it has its own lower per-account rate limit. ${FREE}`,
			security: READ_SECURITY,
			parameters: [INDEX_BLOCK_HASH_PARAM],
			responses: responses(
				binary200("The witness bytes. Immutable.", {
					"x-block-height": {
						description: "Stacks height of the block.",
						schema: { type: "integer" },
					},
					"x-state-root": {
						description:
							"The `state_index_root` the witness recomputes to, hex. A hint: check it against the signed header.",
						schema: { type: "string" },
					},
				}),
				"The sidecar has no block with that `index_block_hash`",
				{ sidecar: true },
			),
		},
	},
	"/v1/proofs/burn/{consensus_hash}": {
		get: {
			tags: ["proofs"],
			summary: "Burn block behind a consensus hash",
			description: `The sortition preimage that hashes to a block header's \`consensus_hash\` (RIPEMD160(SHA256(preimage))). Bytes 4..36 of the preimage are the Bitcoin block hash, which pins the header's burn height against Bitcoin proof of work. ${FREE}`,
			security: READ_SECURITY,
			parameters: [
				{
					...pp(
						"consensus_hash",
						"The header's `consensus_hash`: 40 hex characters, `0x` optional.",
					),
					schema: {
						type: "string",
						pattern: "^(0x)?[0-9a-fA-F]{40}$",
						example: "e55512fc4a1fd7b3c6b0bcd1b0b2d28a7e3f9c11",
					},
				},
			],
			responses: responses(
				json200(
					ref("ProofBurnBlock"),
					"The preimage and the burn block it names",
				),
				"No sortition with that consensus hash",
				{ sidecar: true },
			),
		},
	},
	"/v1/proofs/bitcoin-headers": {
		get: {
			tags: ["proofs"],
			summary: "Bitcoin block headers",
			description: `Raw 80-byte Bitcoin headers from \`from\`, at most ${MAX_BITCOIN_HEADERS} (one difficulty period) per call. Check proof of work and linkage yourself from a checkpoint you trust. ${FREE}`,
			security: READ_SECURITY,
			parameters: [
				qp("from", "integer", true, "First Bitcoin height to return."),
				{
					...qp(
						"count",
						"integer",
						true,
						`Number of headers, 1 to ${MAX_BITCOIN_HEADERS}.`,
					),
					schema: { type: "integer", minimum: 1, maximum: MAX_BITCOIN_HEADERS },
				},
			],
			responses: responses(
				json200(
					ref("BitcoinHeaders"),
					"Consecutive headers starting at `from`",
				),
				"The sidecar has no header at `from`",
				{ sidecar: true },
			),
		},
	},
	"/v1/proofs/block/{index_block_hash}": {
		get: {
			tags: ["proofs"],
			summary: "Signed block by id",
			description: `The consensus-serialized Nakamoto block from the Stacks node (\`/v3/blocks/{id}\`): header with signer signatures, then transactions. Recompute the block id from the header and check the signatures against the cycle's signer set. ${FREE}`,
			security: READ_SECURITY,
			parameters: [INDEX_BLOCK_HASH_PARAM],
			responses: responses(
				binary200("The block bytes. Immutable."),
				"The node has no block with that `index_block_hash`",
			),
		},
	},
	"/v1/proofs/block/height/{height}": {
		get: {
			tags: ["proofs"],
			summary: "Signed block by height",
			description: `The node's block at a Stacks height (\`/v3/blocks/height/{height}\`), same bytes as the by-id route. Near the tip the block at a height can change, so this is short-cached; prefer the by-id route once you know the id. ${FREE}`,
			security: READ_SECURITY,
			parameters: [
				{
					...pp("height", "Stacks block height."),
					schema: { type: "integer", minimum: 0, example: 9048502 },
				},
			],
			responses: responses(
				binary200("The block bytes."),
				"The node has no block at that height",
			),
		},
	},
	"/v1/proofs/epoch2-header/{index_block_hash}": {
		get: {
			tags: ["proofs"],
			summary: "Epoch 2.x block header by id",
			description: `A pre-Nakamoto block's header from the Stacks node (\`/v2/headers/1?tip={id}\`), as the node's one-element array: \`header\` (consensus-serialized StacksBlockHeader, hex), \`consensus_hash\` and \`parent_block_id\`. The id is sha512/256(sha512/256(header) || consensus_hash): recompute it, then check state against the header's \`state_index_root\`. Nakamoto blocks are a 404 here; use the block route. ${FREE}`,
			security: READ_SECURITY,
			parameters: [INDEX_BLOCK_HASH_PARAM],
			responses: responses(
				json200(
					{
						type: "array",
						items: ref("Epoch2Header"),
						example: [EPOCH2_HEADER_EXAMPLE],
					},
					"The block's header and consensus hash",
				),
				"The node has no epoch 2.x block with that `index_block_hash`",
			),
		},
	},
	"/v1/proofs/marf/{path}": {
		get: {
			tags: ["proofs"],
			summary: "MARF inclusion proof",
			description: `A value and its MARF inclusion proof as of block \`tip\`, from the node (\`/v2/clarity/marf/{path}?proof=1\`). Keys the node cannot serve because they hold no stored value string, such as the MARF's own \`__MARF_BLOCK_HEIGHT_TO_HASH::<height>\`, are proven by the proof sidecar from the MARF itself: same proof bytes, and \`data\` is the raw 40-byte leaf value. Fold the proof to a root and compare it with \`tip\`'s \`state_index_root\`. Inclusion only: a missing key is a 404, not a proof of absence. ${FREE}`,
			security: READ_SECURITY,
			parameters: [
				{
					...pp("path", "The MARF key hash: 64 hex characters, `0x` optional."),
					schema: {
						...HASH32,
						example:
							"5c8d9e1f6c1e0f4a2a6a7f0b0f5f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
					},
				},
				{
					...qp(
						"tip",
						"string",
						true,
						"`index_block_hash` of the block to prove against, 64 hex characters, `0x` optional. Pinned, so the answer is immutable.",
					),
					schema: { ...HASH32, example: INDEX_BLOCK_HASH_EXAMPLE },
				},
			],
			responses: responses(
				json200(ref("MarfProof"), "The value and its proof"),
				"No value at that path as of `tip`",
			),
		},
	},
};

/** Resource schemas for these responses, merged into `components.schemas`. */
export const proofsSchemas = {
	ProofBurnBlock: {
		type: "object",
		description:
			"A sortition's consensus-hash preimage and the Bitcoin block it commits to.",
		properties: {
			consensus_hash: {
				type: "string",
				description: "The consensus hash asked about, hex.",
			},
			burn_height: {
				type: "integer",
				description: "Bitcoin height of the sortition.",
			},
			bitcoin_block_hash: {
				type: "string",
				description:
					"Bitcoin block hash, display order. Equals preimage bytes 4..36.",
			},
			preimage: {
				type: "string",
				description:
					"Hex bytes whose RIPEMD160(SHA256(·)) is `consensus_hash`.",
			},
		},
		example: {
			consensus_hash: "e55512fc4a1fd7b3c6b0bcd1b0b2d28a7e3f9c11",
			burn_height: 970269,
			bitcoin_block_hash:
				"00000000000000000001b6b3c5a9e2b5d8f8f1c0a7e4d3b2a1908f7e6d5c4b3a",
			preimage:
				"0100000000000000000000000001b6b3c5a9e2b5d8f8f1c0a7e4d3b2a1908f7e6d5c4b3a…",
		},
	},
	BitcoinHeaders: {
		type: "object",
		description: "Consecutive raw Bitcoin block headers.",
		properties: {
			from: {
				type: "integer",
				description: "Bitcoin height of the first header.",
			},
			headers: {
				type: "array",
				items: { type: "string" },
				description: "80-byte headers, hex, in height order.",
			},
		},
		// Bitcoin's genesis header.
		example: {
			from: 0,
			headers: [
				"0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c",
			],
		},
	},
	Epoch2Header: {
		type: "object",
		description: "A pre-Nakamoto block header, as the node returns it.",
		properties: {
			consensus_hash: {
				type: "string",
				description:
					"Consensus hash of the sortition that elected the block, hex.",
			},
			header: {
				type: "string",
				description:
					"Consensus-serialized StacksBlockHeader (247 bytes), hex. Its sha512/256 is the block hash.",
			},
			parent_block_id: {
				type: "string",
				description:
					"The parent's `index_block_hash`, hex. A hint: the header commits only to the parent's block hash.",
			},
		},
		example: EPOCH2_HEADER_EXAMPLE,
	},
	MarfProof: {
		type: "object",
		description:
			"A MARF value and its inclusion proof, as the node returns them.",
		properties: {
			data: {
				type: "string",
				description:
					"The stored value, hex (`0x`-prefixed). For keys with no stored value (`__MARF_*`), the raw 40-byte leaf value instead.",
			},
			proof: {
				type: "string",
				description:
					"Serialized MARF proof, hex (`0x`-prefixed). Proof bytes are malleable: hash the parsed content, never use them as an id.",
			},
		},
		example: { data: "0x0100000000000000000000000000000064", proof: "0x00…" },
	},
};
