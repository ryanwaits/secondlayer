import { POX5_EVENT_TOPICS } from "@secondlayer/stacks/pox5";
import { SBTC_EVENT_TOPICS } from "@secondlayer/stacks/sbtc";
import {
	SBTC_DEPOSIT_FIELDS,
	SBTC_WITHDRAWAL_ALWAYS,
	SBTC_WITHDRAWAL_FIELDS,
	type SbtcWithdrawalStatus,
} from "../../index/sbtc-peg.ts";
import {
	ERROR_401,
	ERROR_429,
	INDEX_RANGE_PARAMS,
	READ_SECURITY,
	envelope,
	json200,
	jsonError,
	pp,
	qp,
} from "./shared.ts";

/**
 * The withdrawal status vocabulary. `sbtc-peg.ts` declares it as a type only,
 * so the list lives here and the compiler holds it to that type both ways: a
 * status added there without being added here fails the check below.
 */
const WITHDRAWAL_STATUSES = [
	"REQUESTED",
	"ACCEPTED",
	"REJECTED",
] as const satisfies readonly SbtcWithdrawalStatus[];
const _withdrawalStatusesExhaustive: Exclude<
	SbtcWithdrawalStatus,
	(typeof WITHDRAWAL_STATUSES)[number]
> extends never
	? true
	: never = true;
void _withdrawalStatusesExhaustive;

const LIMIT = { $ref: "#/components/parameters/Limit" };

/** `/stacking` pages on (block_height, tx_index), not the event keyset the
 *  shared range params describe (`parseTxIndexCursor`). */
const TX_CURSOR_RANGE_PARAMS = [
	{
		...qp(
			"cursor",
			"string",
			false,
			"`<block_height>:<tx_index>` from a previous page's `next_cursor`. Resumes after it.",
		),
		schema: { type: "string", example: "8647822:1" },
	},
	...INDEX_RANGE_PARAMS.slice(1),
];

/** `parseSbtcBaseQuery`: `true` clamps `to_height` to the finality boundary. */
const SBTC_CONFIRMED = qp(
	"confirmed",
	"boolean",
	false,
	"`true` stops the page at the finality boundary, so every row is past the reorg margin.",
);

const POX4_NOTES = {
	type: "string",
	description:
		"Present only when the feed cannot grow: PoX-4 decoding is off on this instance, or the PoX-4 era closed at the epoch 4.0 fork.",
};

const SBTC_NOTES = {
	type: "string",
	description: "Present only when sBTC decoding is off on this instance.",
};

/** Envelope plus the `notes` field these routes add, and the 304 their
 *  finality cache answers with (`applyIndexCache`). */
function feedResponses(
	rowKey: string,
	row: string,
	opts: { cached: boolean; notes: Record<string, unknown> },
): Record<string, unknown> {
	const base = envelope(rowKey, { $ref: `#/components/schemas/${row}` });
	const success = base["200"] as {
		content: { "application/json": { schema: { properties: object } } };
	};
	const schema = success.content["application/json"].schema;
	schema.properties = { ...schema.properties, notes: opts.notes };
	return opts.cached
		? {
				...base,
				"304": {
					description:
						"The page is past finality and matches your `If-None-Match` ETag.",
				},
			}
		: base;
}

/** A tip read from mainnet alongside the examples below (2026-09-23). */
const TIP_EXAMPLE = {
	block_height: 9048929,
	finalized_height: 9048671,
	lag_seconds: 22,
	source_block_height: 9048929,
};

const TIP = { $ref: "#/components/schemas/Tip" };

const NOT_MODIFIED_POINT = {
	description:
		"The resource is past finality and matches your `If-None-Match` ETag.",
};

// ── Examples: real mainnet rows, shaped by each route's serializer ──────────

/** `readPoxCycle(105)`. */
const POX_CYCLE_EXAMPLE = {
	reward_cycle: 105,
	total_stacked_ustx: "162",
	unique_stackers: 0,
	unique_delegators: 0,
	action_count: 51,
	start_block_height: 171597,
	end_block_height: 714810,
	is_current: false,
	function_breakdown: [
		{ function_name: "stack-aggregation-increase", count: 11 },
		{ function_name: "stack-aggregation-commit-indexed", count: 40 },
	],
};

/** The `completed-deposit` at 9,048,911:4. */
const SBTC_DEPOSIT_EXAMPLE = {
	cursor: "9048911:4",
	block_height: 9048911,
	block_time: "2026-09-23T15:06:29.000Z",
	tx_id: "0x8600af4a0b2a911e6494d1feea0691068d8b329be0ef2c0d11a7d5aed8f9f4e5",
	tx_index: 2,
	event_index: 4,
	amount: "79856",
	sender: null,
	bitcoin_txid:
		"0x2c11f9e20d21c96daed5d851c07d0e7c4361e552ebd78a8385f06fbb2f9892d3",
	output_index: 1,
	recipient_btc_version: null,
	recipient_btc_hashbytes: null,
};

/** Withdrawal request 3405: accepted, sweep confirmed on Bitcoin. */
const SBTC_WITHDRAWAL_SWEEP =
	"0x0efad88eb01e248fd8321ada99cb74f7258948226eae106f8be5a5917d7473e4";

const SBTC_WITHDRAWAL_LIFECYCLE_EXAMPLE = {
	request_id: 3405,
	status: "ACCEPTED",
	amount: "221653",
	sender: "SP2WRMQD3G4G8BR0120Y390CT6A8BTE6MB0JQ5EHA",
	recipient_btc_version: 4,
	recipient_btc_hashbytes: "0xa7d5ce640208ed037950d4c849c805e881209d6a",
	requested: {
		block_height: 9048225,
		block_time: "2026-09-23T12:01:45.000Z",
		tx_id: "0x0e132d74a062d9327bbf25b371dd3fa7171f5e3479131b046106c1f6086a9780",
	},
	accepted: {
		block_height: 9048547,
		block_time: "2026-09-23T13:24:47.000Z",
		tx_id: "0xddedcfe67fe6c63339781619867816a69fc054e4a83b7358a8f07e983f2a1b68",
		sweep_txid: SBTC_WITHDRAWAL_SWEEP,
		signer_bitmap: "0",
	},
	rejected: null,
	settlement: {
		sweep_txid: SBTC_WITHDRAWAL_SWEEP,
		btc_confirmations: 8,
		settlement_confirmed: true,
		btc_block_height: 968278,
		confirmed_at: "2026-09-23T14:35:25.473Z",
	},
	finalized: true,
};

/** `readSbtcSummary` over mainnet, with supply from `get-total-supply`. */
const SBTC_SUMMARY_EXAMPLE = {
	total_deposits: 28077,
	total_withdrawals_requested: 3408,
	total_withdrawals_accepted: 3328,
	total_withdrawals_rejected: 78,
	net_peg_flow_sats: "756694049870",
	total_locked_sats: "756694049870",
	sbtc_supply_sats: "247872312898",
};

/** Protocol reads decoded from boot and protocol contracts: PoX-4, PoX-5, sBTC. */
export const protocolsPaths = {
	"/v1/index/stacking": {
		get: {
			tags: ["index"],
			summary: "PoX-4 stacking actions",
			description:
				"Decoded PoX-4 contract calls (`stack-stx`, `delegate-stx`, `stack-aggregation-commit-indexed`, …), one row per call, oldest first. Pages on `<block_height>:<tx_index>`. With no cursor or `from_height`, the read covers the last day. PoX-4 stopped at the epoch 4.0 fork, so read history with `from_height` and use `/v1/index/pox5/events` for what came after.",
			security: READ_SECURITY,
			parameters: [
				LIMIT,
				...TX_CURSOR_RANGE_PARAMS,
				qp(
					"function_name",
					"string",
					false,
					"PoX-4 function name, e.g. `stack-stx` or `delegate-stack-stx`. Exact match.",
				),
				qp(
					"stacker",
					"string",
					false,
					"Stacker principal named in the call. Exact match. Solo `stack-stx` calls leave it null, so filter those by `caller`.",
				),
				qp("caller", "string", false, "Transaction sender. Exact match."),
			],
			responses: feedResponses("stacking", "StackingAction", {
				cached: true,
				notes: POX4_NOTES,
			}),
			"x-codeSamples": [
				{
					lang: "TypeScript",
					label: "SDK",
					source:
						'const page = await sl.index.stacking.list({\n  functionName: "stack-stx",\n  fromHeight: 8640000,\n});',
				},
			],
		},
	},
	"/v1/index/pox/cycles": {
		get: {
			tags: ["index"],
			summary: "PoX-4 reward-cycle aggregates",
			description:
				"One rollup per PoX-4 reward cycle, newest first: amount, action count, block range and a per-function breakdown. A cycle groups the calls that name a reward cycle, which are the aggregation commits and increases; solo and delegated stacking calls carry none and are not counted. Completed cycles cache for an hour.",
			security: READ_SECURITY,
			parameters: [
				{
					name: "limit",
					in: "query",
					schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
					description:
						"Cycles per page, 1 to 100. Defaults to 20; anything else is refused.",
				},
				{
					name: "cursor",
					in: "query",
					schema: { type: "integer", minimum: 0, example: 84 },
					description:
						"`next_cursor` from the previous page. Returns cycles below it.",
				},
			],
			responses: {
				"200": json200(
					{
						type: "object",
						required: ["cycles", "next_cursor", "tip"],
						properties: {
							cycles: {
								type: "array",
								items: { $ref: "#/components/schemas/PoxCycle" },
							},
							next_cursor: {
								type: ["integer", "null"],
								description:
									"The last cycle on this page when more remain. Pass it back as `cursor`. `null` on the last page.",
								example: 104,
							},
							tip: TIP,
							notes: POX4_NOTES,
						},
					},
					"Reward cycles, newest first",
				),
				"400": jsonError(
					"`limit` or `cursor` is out of range, or an unknown parameter was sent",
				),
				"401": jsonError(ERROR_401),
				"429": jsonError(ERROR_429),
			},
			"x-codeSamples": [
				{
					lang: "TypeScript",
					label: "SDK",
					source: "const page = await sl.index.pox.cycles.list({ limit: 10 });",
				},
			],
		},
	},
	"/v1/index/pox/cycles/{reward_cycle}": {
		get: {
			tags: ["index"],
			summary: "PoX-4 reward-cycle aggregate by cycle number",
			description:
				"The rollup for one PoX-4 reward cycle, the same shape as a row of `/v1/index/pox/cycles`.",
			security: READ_SECURITY,
			parameters: [
				{
					...pp("reward_cycle", "Reward cycle number."),
					schema: { type: "integer", minimum: 0, example: 105 },
				},
			],
			responses: {
				"200": json200(
					{
						type: "object",
						required: ["cycle", "tip"],
						properties: {
							cycle: { $ref: "#/components/schemas/PoxCycle" },
							tip: TIP,
							notes: POX4_NOTES,
						},
						example: {
							cycle: POX_CYCLE_EXAMPLE,
							tip: TIP_EXAMPLE,
							notes:
								"PoX-4 ended at the epoch 4.0 activation; these cycles are final. PoX-5 era data is at /v1/index/pox5/events.",
						},
					},
					"The cycle's rollup",
				),
				"400": jsonError("`reward_cycle` is not a non-negative integer"),
				"401": jsonError(ERROR_401),
				"404": jsonError(
					"No PoX-4 call names this cycle, or PoX-4 decoding is off on this instance",
				),
				"429": jsonError(ERROR_429),
			},
			"x-codeSamples": [
				{
					lang: "TypeScript",
					label: "SDK",
					source: "const res = await sl.index.pox.cycles.get(105);",
				},
			],
		},
	},
	"/v1/index/pox5/events": {
		get: {
			tags: ["index"],
			summary: "PoX-5 boot-contract events (decoded)",
			description:
				"Decoded print log of the pox-5 boot contract (SIP-045 Bitcoin Staking) — all 19 topics (stake, stake-update, register-signer, unstake, claim-rewards, etc.), one row per print. Starts at the epoch 4.0 hard fork, where /v1/index/stacking's pox-4 feed ends.",
			security: READ_SECURITY,
			parameters: [
				{ $ref: "#/components/parameters/Limit" },
				...INDEX_RANGE_PARAMS,
				qp(
					"confirmed",
					"boolean",
					false,
					"`true` stops the page at the finality boundary, so every row is past the reorg margin.",
				),
				{
					...qp(
						"topic",
						"string",
						false,
						"One print topic. Omit for all of them.",
					),
					schema: {
						type: "string",
						enum: [...POX5_EVENT_TOPICS],
						example: "stake",
					},
				},
				qp("staker", "string", false, "Staker principal. Exact match."),
				{
					...qp(
						"signer",
						"string",
						false,
						"Signer-manager contract on stake-side topics (`stake`, `stake-update`, `unstake`, `register-signer`, `register-for-bond`). A pool's claims and key grants carry it in `signer_manager` instead, so filter both to see a pool's full activity.",
					),
					schema: {
						type: "string",
						example:
							"SP8HK160YD5GHXP69VGA0TC7AQJ1X4CDW3XVERSE.xverse-signer-manager-3",
					},
				},
				qp(
					"signer_manager",
					"string",
					false,
					"Signer-manager contract on claim and grant topics (`claim-rewards`, `claim-staker-rewards-for-signer`, `grant-signer-key`, `revoke-signer-grant`). Stake-side topics carry it in `signer`.",
				),
				qp("bond_index", "integer", false, "Bond index. Exact match."),
				qp("reward_cycle", "integer", false, "Reward cycle. Exact match."),
				qp(
					"fields",
					"string",
					false,
					"Comma-separated columns to return. `cursor`, `block_height` and `topic` always come back; an unknown name is refused.",
				),
			],
			responses: envelope("events", {
				$ref: "#/components/schemas/Pox5Event",
			}),
			"x-codeSamples": [
				{
					lang: "TypeScript",
					label: "SDK",
					source:
						'const page = await sl.index.pox5.events.list({\n  signer: "SP8HK160YD5GHXP69VGA0TC7AQJ1X4CDW3XVERSE.xverse-signer-manager-3",\n  topic: "stake",\n  limit: 50,\n});',
				},
			],
		},
	},
	"/v1/index/sbtc/events": {
		get: {
			tags: ["index"],
			summary: "sBTC peg events (decoded)",
			description:
				"Every decoded `sbtc-registry` print, all topics, one row per event, oldest first: deposits, withdrawal create/accept/reject, signer key rotations and protocol-contract updates. With no cursor or `from_height`, the read covers the last day.",
			security: READ_SECURITY,
			parameters: [
				LIMIT,
				...INDEX_RANGE_PARAMS,
				SBTC_CONFIRMED,
				{
					...qp(
						"topic",
						"string",
						false,
						"One print topic. Omit for all of them; an unknown topic is refused.",
					),
					schema: { type: "string", enum: [...SBTC_EVENT_TOPICS] },
				},
				qp(
					"sender",
					"string",
					false,
					"Stacks principal on the event (the withdrawal requester on `withdrawal-create`). Exact match.",
				),
				{
					...qp(
						"request_id",
						"integer",
						false,
						"Withdrawal request id. Exact match.",
					),
					schema: { type: "integer", minimum: 0 },
				},
				qp(
					"bitcoin_txid",
					"string",
					false,
					"Bitcoin txid on the event, `0x`-prefixed hex. Exact match.",
				),
			],
			responses: feedResponses("events", "SbtcEvent", {
				cached: true,
				notes: SBTC_NOTES,
			}),
			"x-codeSamples": [
				{
					lang: "TypeScript",
					label: "SDK",
					source:
						'const page = await sl.index.sbtc.events.list({\n  topic: "withdrawal-create",\n});',
				},
			],
		},
	},
	"/v1/index/sbtc/deposits": {
		get: {
			tags: ["index"],
			summary: "sBTC peg-ins (completed deposits)",
			description:
				"Completed deposits, one row per `completed-deposit` event, oldest first. The event fires once the signers have swept the BTC in, so every row is final on the peg side. With no cursor or `from_height`, the read covers the last day.",
			security: READ_SECURITY,
			parameters: [
				LIMIT,
				...INDEX_RANGE_PARAMS,
				SBTC_CONFIRMED,
				qp(
					"sender",
					"string",
					false,
					"Stacks principal on the event. Exact match. Mainnet deposits currently carry none.",
				),
				qp(
					"bitcoin_txid",
					"string",
					false,
					"Deposit's Bitcoin txid, `0x`-prefixed hex. Exact match.",
				),
				qp(
					"fields",
					"string",
					false,
					`Comma-separated columns to return, from: ${SBTC_DEPOSIT_FIELDS.map((f) => `\`${f}\``).join(", ")}. \`cursor\` and \`block_height\` always come back; an unknown name is refused.`,
				),
			],
			responses: feedResponses("deposits", "SbtcDeposit", {
				cached: true,
				notes: SBTC_NOTES,
			}),
			"x-codeSamples": [
				{
					lang: "TypeScript",
					label: "SDK",
					source:
						"const page = await sl.index.sbtc.deposits.list({ confirmed: true });",
				},
			],
		},
	},
	"/v1/index/sbtc/deposits/{bitcoin_txid}": {
		get: {
			tags: ["index"],
			summary: "sBTC peg-in by Bitcoin txid",
			description:
				"One completed deposit, looked up by the Bitcoin txid of the deposit. Past finality it is cached for good and answers `If-None-Match` with 304.",
			security: READ_SECURITY,
			parameters: [
				{
					...pp(
						"bitcoin_txid",
						"Deposit's Bitcoin txid, `0x`-prefixed hex, as it appears in `bitcoin_txid`.",
					),
					schema: {
						type: "string",
						example:
							"0x2c11f9e20d21c96daed5d851c07d0e7c4361e552ebd78a8385f06fbb2f9892d3",
					},
				},
			],
			responses: {
				"200": json200(
					{
						type: "object",
						required: ["deposit", "tip"],
						properties: {
							deposit: { $ref: "#/components/schemas/SbtcDepositDetail" },
							tip: TIP,
						},
						example: {
							deposit: { ...SBTC_DEPOSIT_EXAMPLE, status: "COMPLETED" },
							tip: TIP_EXAMPLE,
						},
					},
					"The deposit",
				),
				"304": NOT_MODIFIED_POINT,
				"401": jsonError(ERROR_401),
				"404": jsonError("No completed deposit has this Bitcoin txid"),
				"429": jsonError(ERROR_429),
			},
			"x-codeSamples": [
				{
					lang: "TypeScript",
					label: "SDK",
					source:
						'const res = await sl.index.sbtc.deposits.get(\n  "0x2c11f9e20d21c96daed5d851c07d0e7c4361e552ebd78a8385f06fbb2f9892d3",\n);',
				},
			],
		},
	},
	"/v1/index/sbtc/withdrawals": {
		get: {
			tags: ["index"],
			summary: "sBTC peg-outs (lifecycle, one per request_id)",
			description:
				"Withdrawals, one row per `request_id`, ordered by when they were requested. Each row carries its current status from the latest accept or reject, the BTC sweep the signers committed to, and that sweep's Bitcoin settlement. The height window and cursor apply to the request event. Status can change after a row is final, so pages are never long-cached.",
			security: READ_SECURITY,
			parameters: [
				LIMIT,
				...INDEX_RANGE_PARAMS,
				SBTC_CONFIRMED,
				{
					...qp("status", "string", false, "Current lifecycle status."),
					schema: { type: "string", enum: [...WITHDRAWAL_STATUSES] },
				},
				qp(
					"sender",
					"string",
					false,
					"Requester's Stacks principal. Exact match.",
				),
				{
					...qp(
						"request_id",
						"integer",
						false,
						"Withdrawal request id. Exact match.",
					),
					schema: { type: "integer", minimum: 0 },
				},
				qp(
					"settlement_confirmed",
					"boolean",
					false,
					"`true` returns withdrawals whose sweep has confirmed on Bitcoin. `false` returns the rest, including ones with no sweep yet.",
				),
				qp(
					"fields",
					"string",
					false,
					`Comma-separated columns to return, from: ${SBTC_WITHDRAWAL_FIELDS.map((f) => `\`${f}\``).join(", ")}. ${SBTC_WITHDRAWAL_ALWAYS.map((f) => `\`${f}\``).join(" and ")} always come back; an unknown name is refused.`,
				),
			],
			responses: feedResponses("withdrawals", "SbtcWithdrawal", {
				cached: false,
				notes: SBTC_NOTES,
			}),
			"x-codeSamples": [
				{
					lang: "TypeScript",
					label: "SDK",
					source:
						'const page = await sl.index.sbtc.withdrawals.list({\n  status: "ACCEPTED",\n  settlementConfirmed: false,\n});',
				},
			],
		},
	},
	"/v1/index/sbtc/withdrawals/{request_id}": {
		get: {
			tags: ["index"],
			summary: "sBTC peg-out lifecycle by request_id",
			description:
				"One withdrawal's full lifecycle: the request, the accept or reject, and the Bitcoin settlement of its sweep. Once it is accepted or rejected and past finality, it is cached for good and answers `If-None-Match` with 304.",
			security: READ_SECURITY,
			parameters: [
				{
					...pp("request_id", "Withdrawal request id."),
					schema: { type: "integer", minimum: 0, example: 3405 },
				},
			],
			responses: {
				"200": json200(
					{
						type: "object",
						required: ["withdrawal", "tip"],
						properties: {
							withdrawal: {
								$ref: "#/components/schemas/SbtcWithdrawalLifecycle",
							},
							tip: TIP,
						},
						example: {
							withdrawal: SBTC_WITHDRAWAL_LIFECYCLE_EXAMPLE,
							tip: TIP_EXAMPLE,
						},
					},
					"The withdrawal's lifecycle",
				),
				"304": NOT_MODIFIED_POINT,
				"400": jsonError("`request_id` is not a non-negative integer"),
				"401": jsonError(ERROR_401),
				"404": jsonError("No withdrawal request has this id"),
				"429": jsonError(ERROR_429),
			},
			"x-codeSamples": [
				{
					lang: "TypeScript",
					label: "SDK",
					source: "const res = await sl.index.sbtc.withdrawals.get(3405);",
				},
			],
		},
	},
	"/v1/index/sbtc/summary": {
		get: {
			tags: ["index"],
			summary: "sBTC peg summary scoreboard",
			description:
				"All-time totals for the whole bridge: deposit and withdrawal counts, net peg flow, and circulating sBTC supply read from `sbtc-token` on this instance's node. Takes no parameters.",
			security: READ_SECURITY,
			parameters: [],
			responses: {
				"200": json200(
					{
						type: "object",
						required: ["summary", "tip"],
						properties: {
							summary: { $ref: "#/components/schemas/SbtcSummary" },
							tip: TIP,
							notes: {
								type: "string",
								description:
									"Present only when sBTC decoding is off on this instance.",
							},
						},
						example: { summary: SBTC_SUMMARY_EXAMPLE, tip: TIP_EXAMPLE },
					},
					"The bridge totals",
				),
				"401": jsonError(ERROR_401),
				"429": jsonError(ERROR_429),
			},
			"x-codeSamples": [
				{
					lang: "TypeScript",
					label: "SDK",
					source: "const { summary } = await sl.index.sbtc.summary();",
				},
			],
		},
	},
};

// ── Shared property blocks ──────────────────────────────────────────────────

const CURSOR_PROP = {
	type: "string",
	description: "`<block_height>:<event_index>`. Pass as `cursor`.",
};

const BLOCK_TIME_PROP = {
	type: ["string", "null"],
	format: "date-time",
	description: "That block's timestamp.",
};

const RECIPIENT_BTC_VERSION = {
	type: ["integer", "null"],
	description:
		"Bitcoin address type of the recipient: 0 p2pkh, 1 p2sh, 2 p2sh-p2wpkh, 3 p2sh-p2wsh, 4 p2wpkh, 5 p2wsh, 6 p2tr.",
};

const RECIPIENT_BTC_HASHBYTES = {
	type: ["string", "null"],
	description: "Recipient's hash bytes, `0x`-prefixed hex.",
};

const SATS_AMOUNT = {
	type: ["string", "null"],
	description: "Satoshis as a decimal string (bigint-safe).",
};

const SBTC_DEPOSIT_PROPERTIES = {
	cursor: CURSOR_PROP,
	block_height: {
		type: "integer",
		description: "Stacks block the deposit completed in.",
	},
	block_time: BLOCK_TIME_PROP,
	tx_id: {
		type: "string",
		description: "Stacks transaction that completed the deposit.",
	},
	tx_index: { type: "integer", description: "Its position in the block." },
	event_index: {
		type: "integer",
		description:
			"The event's position in the block. With `block_height`, the cursor.",
	},
	amount: { ...SATS_AMOUNT, description: "Sats minted, as a decimal string." },
	sender: {
		type: ["string", "null"],
		description:
			"Stacks principal on the event. Null on mainnet deposits today.",
	},
	bitcoin_txid: {
		type: ["string", "null"],
		description: "The deposit's Bitcoin txid, `0x`-prefixed hex.",
	},
	output_index: {
		type: ["integer", "null"],
		description: "The deposit output within that Bitcoin transaction.",
	},
	recipient_btc_version: RECIPIENT_BTC_VERSION,
	recipient_btc_hashbytes: RECIPIENT_BTC_HASHBYTES,
};

const PHASE_SCHEMA = {
	type: "object",
	properties: {
		block_height: {
			type: "integer",
			description: "Stacks block of the event.",
		},
		block_time: BLOCK_TIME_PROP,
		tx_id: { type: "string", description: "Stacks transaction of the event." },
	},
};

const STATUS_PROP = {
	type: "string",
	enum: [...WITHDRAWAL_STATUSES],
	description:
		"`REQUESTED` until the signers act, then `ACCEPTED` or `REJECTED` from the latest resolution event.",
};

/** Resource schemas for these rows, merged into `components.schemas`. */
export const protocolsSchemas = {
	StackingAction: {
		type: "object",
		description:
			"One decoded PoX-4 contract call. Which columns are set depends on `function_name`; a failed call sets only the base fields.",
		required: [
			"cursor",
			"block_height",
			"burn_block_height",
			"tx_id",
			"tx_index",
			"function_name",
			"caller",
			"pox_addr",
			"result_ok",
		],
		properties: {
			cursor: {
				type: "string",
				description: "`<block_height>:<tx_index>`. Pass as `cursor`.",
			},
			block_height: {
				type: "integer",
				description: "Stacks block the call landed in.",
			},
			block_time: BLOCK_TIME_PROP,
			burn_block_height: {
				type: "integer",
				description: "Bitcoin block that Stacks block anchors to.",
			},
			tx_id: { type: "string", description: "The calling transaction." },
			tx_index: {
				type: "integer",
				description:
					"Its position in the block. With `block_height`, the cursor.",
			},
			function_name: {
				type: "string",
				description: "PoX-4 function called, e.g. `stack-stx`.",
			},
			caller: { type: "string", description: "Transaction sender." },
			stacker: {
				type: ["string", "null"],
				description:
					"Stacker the call acts on, on delegate-side calls. Null on solo `stack-stx`, where `caller` is the stacker.",
			},
			delegate_to: {
				type: ["string", "null"],
				description: "Pool operator, on `delegate-stx`.",
			},
			amount_ustx: {
				type: ["string", "null"],
				description:
					"microSTX as a decimal string (bigint-safe): the amount locked, delegated or increased by.",
			},
			lock_period: {
				type: ["integer", "null"],
				description: "Cycles locked, or extended by.",
			},
			pox_addr: {
				type: "object",
				description:
					"Bitcoin reward address. Every field is null when the call names none.",
				properties: {
					version: {
						type: ["integer", "null"],
						description: "Bitcoin address type byte.",
					},
					hashbytes: {
						type: ["string", "null"],
						description: "Address hash bytes, `0x`-prefixed hex.",
					},
					btc: {
						type: ["string", "null"],
						description: "The same address, encoded.",
					},
				},
			},
			start_cycle: {
				type: ["integer", "null"],
				description: "First reward cycle the lock covers.",
			},
			end_cycle: {
				type: ["integer", "null"],
				description: "Last reward cycle the lock covers.",
			},
			reward_cycle: {
				type: ["integer", "null"],
				description:
					"Reward cycle named by aggregation and signer-key calls. What `/v1/index/pox/cycles` groups on.",
			},
			signer_key: {
				type: ["string", "null"],
				description: "Signer public key, `0x`-prefixed hex.",
			},
			result_ok: {
				type: "boolean",
				description: "Whether the call returned `ok`.",
			},
		},
		// A real row: mainnet, block 8,647,822.
		example: {
			cursor: "8647822:1",
			block_height: 8647822,
			block_time: "2026-07-27T18:39:09.000Z",
			burn_block_height: 959869,
			tx_id:
				"0x995fb653065c74596b63e6cc9c10fb8fa7b8f3574d5ea089b45d3e11d9e7336e",
			tx_index: 1,
			function_name: "stack-stx",
			caller: "SP14S259H3AC9PXWJ8EVX9ER5NZ58R03GR4QAKHCB",
			stacker: null,
			delegate_to: null,
			amount_ustx: "4491100000000",
			lock_period: 1,
			pox_addr: {
				version: 6,
				hashbytes:
					"0x6f0fbc92d6ad56a9d7783b7420ae6731434831e3484d82ad54afe32d7fc7ad6d",
				btc: "bc1pdu8meykk44t2n4mc8d6zptn8x9p5sv0rfpxc9t254l3j6l7844ksz4jjcs",
			},
			start_cycle: 139,
			end_cycle: 139,
			reward_cycle: null,
			signer_key:
				"0x031b91a32ab90b80d40715e8875fb3dfe996aa1e6f5e62ba05d34542aa58ad43b5",
			result_ok: true,
		},
	},
	PoxCycle: {
		type: "object",
		description:
			"Rollup of the canonical PoX-4 calls that name one reward cycle: the aggregation commits and increases.",
		required: [
			"reward_cycle",
			"total_stacked_ustx",
			"unique_stackers",
			"unique_delegators",
			"action_count",
			"start_block_height",
			"end_block_height",
			"is_current",
			"function_breakdown",
		],
		properties: {
			reward_cycle: { type: "integer", description: "The reward cycle." },
			total_stacked_ustx: {
				type: "string",
				description:
					"Sum of `amount_ustx` over the cycle's calls, as a decimal string. Commits carry no amount, so this is the sum of aggregation increases.",
			},
			unique_stackers: {
				type: "integer",
				description:
					"Distinct non-null `stacker` values among the cycle's calls.",
			},
			unique_delegators: {
				type: "integer",
				description:
					"Distinct callers of `delegate-*` functions among the cycle's calls.",
			},
			action_count: {
				type: "integer",
				description: "Calls that name this cycle.",
			},
			start_block_height: {
				type: "integer",
				description: "Stacks block of the first such call.",
			},
			end_block_height: {
				type: "integer",
				description: "Stacks block of the last such call.",
			},
			is_current: {
				type: "boolean",
				description:
					"True for the highest cycle while PoX-4 is still live. Always false after the epoch 4.0 fork.",
			},
			function_breakdown: {
				type: "array",
				description: "Call count per function.",
				items: {
					type: "object",
					properties: {
						function_name: {
							type: "string",
							description: "PoX-4 function name.",
						},
						count: { type: "integer", description: "Calls to it." },
					},
				},
			},
		},
		// A real row: mainnet, reward cycle 105.
		example: POX_CYCLE_EXAMPLE,
	},
	Pox5Event: {
		type: "object",
		description:
			"One print event from the pox-5 boot contract, decoded. Promoted columns cover the common filters; `data` always holds the complete tuple, so no topic loses fields.",
		required: [
			"cursor",
			"block_height",
			"tx_id",
			"tx_index",
			"event_index",
			"topic",
			"data",
		],
		properties: {
			cursor: {
				type: "string",
				description: "`<block_height>:<event_index>`. Pass as `cursor`.",
			},
			block_height: {
				type: "integer",
				description: "Stacks block the print landed in.",
			},
			block_time: {
				type: ["string", "null"],
				format: "date-time",
				description: "That block's timestamp.",
			},
			tx_id: {
				type: "string",
				description: "Transaction that emitted the print.",
			},
			tx_index: {
				type: "integer",
				description: "Its position in the block.",
			},
			event_index: {
				type: "integer",
				description:
					"The event's position in the block. With `block_height`, the cursor.",
			},
			topic: {
				type: "string",
				enum: [...POX5_EVENT_TOPICS],
				description: "The print topic. Decides which columns are set.",
			},
			staker: {
				type: ["string", "null"],
				description: "Staker principal.",
			},
			signer: {
				type: ["string", "null"],
				description: "Signer-manager contract, on stake-side topics.",
			},
			signer_manager: {
				type: ["string", "null"],
				description: "Signer-manager contract, on claim and grant topics.",
			},
			bond_index: {
				type: ["integer", "null"],
				description: "The bond this event belongs to, on bond topics.",
			},
			amount_ustx: {
				type: ["string", "null"],
				description: "microSTX as a decimal string (bigint-safe).",
			},
			amount_sats: {
				type: ["string", "null"],
				description: "Satoshis as a decimal string (bigint-safe).",
			},
			reward_cycle: {
				type: ["integer", "null"],
				description:
					"Reward cycle the event refers to, on reward and claim topics.",
			},
			first_reward_cycle: {
				type: ["integer", "null"],
				description: "First cycle a stake earns in.",
			},
			unlock_cycle: {
				type: ["integer", "null"],
				description: "Cycle the stake unlocks at.",
			},
			unlock_burn_height: {
				type: ["integer", "null"],
				description: "Bitcoin block height the stake unlocks at.",
			},
			is_l1_lock: {
				type: ["boolean", "null"],
				description: "Bond registrations: whether the lockup is on Bitcoin L1.",
			},
			signer_key: {
				type: ["string", "null"],
				description: "Signer public key, on key-grant topics.",
			},
			data: {
				type: "object",
				description:
					"The full decoded print tuple. Nested shapes (btc-lockup, bond-rewards, bond-periods) come through intact.",
			},
		},
		// A real row: mainnet, block 9,048,679.
		example: {
			cursor: "9048679:0",
			block_height: 9048679,
			block_time: "2026-09-23T13:55:35.000Z",
			tx_id:
				"0xba5c3e57f65a7e92f917c0e8c32bdf11cedb31baefe708c8a3b9177437420ea9",
			tx_index: 0,
			event_index: 0,
			topic: "stake",
			staker: "SP19YK5M97734AJZAA2X8W6J9GGNVM9JFZ751H0F1",
			signer:
				"SP8HK160YD5GHXP69VGA0TC7AQJ1X4CDW3XVERSE.xverse-signer-manager-3",
			signer_manager: null,
			bond_index: null,
			amount_ustx: "550000000",
			amount_sats: null,
			reward_cycle: null,
			first_reward_cycle: 144,
			unlock_cycle: 240,
			unlock_burn_height: 1170050,
			is_l1_lock: null,
			signer_key: null,
			data: {
				topic: "stake",
				signer:
					"SP8HK160YD5GHXP69VGA0TC7AQJ1X4CDW3XVERSE.xverse-signer-manager-3",
				staker: "SP19YK5M97734AJZAA2X8W6J9GGNVM9JFZ751H0F1",
				"num-cycles": "96",
				"amount-ustx": "550000000",
				"unlock-cycle": "240",
				"first-reward-cycle": "144",
				"unlock-burn-height": "1170050",
			},
		},
	},
	SbtcEvent: {
		type: "object",
		description:
			"One decoded `sbtc-registry` print. Every topic shares this shape; `topic` decides which columns are set.",
		required: [
			"cursor",
			"block_height",
			"tx_id",
			"tx_index",
			"event_index",
			"topic",
		],
		properties: {
			cursor: CURSOR_PROP,
			block_height: {
				type: "integer",
				description: "Stacks block the print landed in.",
			},
			block_time: BLOCK_TIME_PROP,
			tx_id: {
				type: "string",
				description: "Transaction that emitted the print.",
			},
			tx_index: { type: "integer", description: "Its position in the block." },
			event_index: {
				type: "integer",
				description:
					"The event's position in the block. With `block_height`, the cursor.",
			},
			topic: {
				type: "string",
				enum: [...SBTC_EVENT_TOPICS],
				description: "The print topic.",
			},
			request_id: {
				type: ["integer", "null"],
				description: "Withdrawal request id, on withdrawal topics.",
			},
			amount: {
				...SATS_AMOUNT,
				description:
					"Sats as a decimal string, on deposits and withdrawal requests.",
			},
			sender: {
				type: ["string", "null"],
				description: "Stacks principal, e.g. the withdrawal requester.",
			},
			recipient_btc_version: RECIPIENT_BTC_VERSION,
			recipient_btc_hashbytes: RECIPIENT_BTC_HASHBYTES,
			bitcoin_txid: {
				type: ["string", "null"],
				description:
					"Bitcoin txid, `0x`-prefixed hex: the deposit transaction, or the sweep on an accept.",
			},
			output_index: {
				type: ["integer", "null"],
				description: "Output within that Bitcoin transaction.",
			},
			sweep_txid: {
				type: ["string", "null"],
				description: "Signers' sweep transaction on Bitcoin.",
			},
			burn_hash: {
				type: ["string", "null"],
				description: "Bitcoin block hash the signers anchored the event to.",
			},
			burn_height: {
				type: ["integer", "null"],
				description: "That Bitcoin block's height.",
			},
			signer_bitmap: {
				type: ["string", "null"],
				description: "Bitmap of the signers' votes, as a decimal string.",
			},
			max_fee: {
				...SATS_AMOUNT,
				description: "Most the requester will pay in BTC fees, in sats.",
			},
			fee: {
				...SATS_AMOUNT,
				description: "BTC fee charged on an accepted withdrawal, in sats.",
			},
			governance_contract_type: {
				type: ["integer", "null"],
				description:
					"Which protocol contract changed, on `update-protocol-contract`.",
			},
			governance_new_contract: {
				type: ["string", "null"],
				description: "The new contract, on `update-protocol-contract`.",
			},
			signer_aggregate_pubkey: {
				type: ["string", "null"],
				description: "New aggregate signer key, on `key-rotation`.",
			},
			signer_threshold: {
				type: ["integer", "null"],
				description: "New signature threshold, on `key-rotation`.",
			},
			signer_address: {
				type: ["string", "null"],
				description: "New signer principal, on `key-rotation`.",
			},
			signer_keys_count: {
				type: ["integer", "null"],
				description: "Number of signer keys in the new set, on `key-rotation`.",
			},
		},
		// A real row: mainnet, withdrawal request 3406.
		example: {
			cursor: "9048486:2",
			block_height: 9048486,
			block_time: "2026-09-23T13:10:19.000Z",
			tx_id:
				"0x0e09fd3cf7628a2cc81083aa9dbb7eebc7bae5cbe277c370e0f8bfc3d1fe00a9",
			tx_index: 2,
			event_index: 2,
			topic: "withdrawal-create",
			request_id: 3406,
			amount: "3127",
			sender: "SP2ADCJ6606CFHERS3HKABWB6PF5XBANXBQ4GSE86",
			recipient_btc_version: 4,
			recipient_btc_hashbytes: "0x9c32e45a19cf9c028bccf12816e62bbfc8eb5fb8",
			bitcoin_txid: null,
			output_index: null,
			sweep_txid: null,
			burn_hash: null,
			burn_height: null,
			signer_bitmap: null,
			max_fee: "1500",
			fee: null,
			governance_contract_type: null,
			governance_new_contract: null,
			signer_aggregate_pubkey: null,
			signer_threshold: null,
			signer_address: null,
			signer_keys_count: null,
		},
	},
	SbtcDeposit: {
		type: "object",
		description:
			"A completed peg-in: one `completed-deposit` event. Keyed by the Bitcoin txid; deposits carry no request id.",
		required: ["cursor", "block_height", "tx_id", "tx_index", "event_index"],
		properties: SBTC_DEPOSIT_PROPERTIES,
		// A real row: mainnet, block 9,048,911.
		example: SBTC_DEPOSIT_EXAMPLE,
	},
	SbtcDepositDetail: {
		type: "object",
		description:
			"A completed peg-in, as returned by the lookup by Bitcoin txid.",
		required: [
			"cursor",
			"block_height",
			"tx_id",
			"tx_index",
			"event_index",
			"status",
		],
		properties: {
			...SBTC_DEPOSIT_PROPERTIES,
			status: {
				type: "string",
				enum: ["COMPLETED"],
				description:
					"Always `COMPLETED`: a deposit is a single terminal event.",
			},
		},
		example: { ...SBTC_DEPOSIT_EXAMPLE, status: "COMPLETED" },
	},
	SbtcWithdrawal: {
		type: "object",
		description:
			"A peg-out rolled up to one row per `request_id`: the request, its current status, and the Bitcoin settlement of its sweep.",
		required: ["cursor", "request_id"],
		properties: {
			cursor: {
				type: "string",
				description:
					"The request event's `<block_height>:<event_index>`. Pass as `cursor`.",
			},
			request_id: { type: "integer", description: "Withdrawal request id." },
			status: STATUS_PROP,
			amount: {
				...SATS_AMOUNT,
				description: "Sats requested, as a decimal string.",
			},
			sender: {
				type: ["string", "null"],
				description: "Requester's Stacks principal.",
			},
			recipient_btc_version: RECIPIENT_BTC_VERSION,
			recipient_btc_hashbytes: RECIPIENT_BTC_HASHBYTES,
			sweep_txid: {
				type: ["string", "null"],
				description:
					"Bitcoin sweep the signers committed to on accept. Null until then.",
			},
			settlement_confirmed: {
				type: ["boolean", "null"],
				description:
					"True once the sweep has confirmed on Bitcoin, false while it is pending, null when there is no sweep or it has not been seen yet.",
			},
			btc_confirmations: {
				type: ["integer", "null"],
				description: "Bitcoin confirmations on the sweep at the last check.",
			},
			btc_block_height: {
				type: ["integer", "null"],
				description: "Bitcoin block the sweep landed in.",
			},
			confirmed_at: {
				type: ["string", "null"],
				format: "date-time",
				description: "When the sweep reached the confirmation threshold.",
			},
			requested_at: {
				type: ["string", "null"],
				format: "date-time",
				description: "Block time of the request.",
			},
			resolved_at: {
				type: ["string", "null"],
				format: "date-time",
				description:
					"Block time of the accept or reject. Null while requested.",
			},
		},
		// A real row: mainnet, withdrawal request 3405.
		example: {
			cursor: "9048225:2",
			request_id: 3405,
			status: "ACCEPTED",
			amount: "221653",
			sender: "SP2WRMQD3G4G8BR0120Y390CT6A8BTE6MB0JQ5EHA",
			recipient_btc_version: 4,
			recipient_btc_hashbytes: "0xa7d5ce640208ed037950d4c849c805e881209d6a",
			sweep_txid: SBTC_WITHDRAWAL_SWEEP,
			settlement_confirmed: true,
			btc_confirmations: 8,
			btc_block_height: 968278,
			confirmed_at: "2026-09-23T14:35:25.473Z",
			requested_at: "2026-09-23T12:01:45.000Z",
			resolved_at: "2026-09-23T13:24:47.000Z",
		},
	},
	SbtcWithdrawalLifecycle: {
		type: "object",
		description:
			"One peg-out's full lifecycle, joined by `request_id`: request, resolution, and Bitcoin settlement.",
		required: [
			"request_id",
			"status",
			"requested",
			"accepted",
			"rejected",
			"settlement",
			"finalized",
		],
		properties: {
			request_id: { type: "integer", description: "Withdrawal request id." },
			status: STATUS_PROP,
			amount: {
				...SATS_AMOUNT,
				description: "Sats requested, as a decimal string.",
			},
			sender: {
				type: ["string", "null"],
				description: "Requester's Stacks principal.",
			},
			recipient_btc_version: RECIPIENT_BTC_VERSION,
			recipient_btc_hashbytes: RECIPIENT_BTC_HASHBYTES,
			requested: {
				...PHASE_SCHEMA,
				description: "The `withdrawal-create` event.",
			},
			accepted: {
				type: ["object", "null"],
				description:
					"The `withdrawal-accept` event, with the sweep it committed to. Null unless accepted.",
				properties: {
					...PHASE_SCHEMA.properties,
					sweep_txid: {
						type: ["string", "null"],
						description: "Bitcoin sweep transaction.",
					},
					signer_bitmap: {
						type: ["string", "null"],
						description: "Bitmap of the signers' votes, as a decimal string.",
					},
				},
			},
			rejected: {
				...PHASE_SCHEMA,
				type: ["object", "null"],
				description: "The `withdrawal-reject` event. Null unless rejected.",
			},
			settlement: {
				type: "object",
				description:
					"Bitcoin settlement of the sweep. Every field is null until the sweep is seen on Bitcoin.",
				properties: {
					sweep_txid: {
						type: ["string", "null"],
						description: "Bitcoin sweep transaction.",
					},
					btc_confirmations: {
						type: ["integer", "null"],
						description: "Confirmations at the last check.",
					},
					settlement_confirmed: {
						type: ["boolean", "null"],
						description:
							"True once the sweep reached the confirmation threshold.",
					},
					btc_block_height: {
						type: ["integer", "null"],
						description: "Bitcoin block the sweep landed in.",
					},
					confirmed_at: {
						type: ["string", "null"],
						format: "date-time",
						description: "When the sweep reached the threshold.",
					},
				},
			},
			finalized: {
				type: "boolean",
				description:
					"True once the withdrawal is accepted or rejected and every event is past finality. Nothing about it will change.",
			},
		},
		// A real row: mainnet, withdrawal request 3405.
		example: SBTC_WITHDRAWAL_LIFECYCLE_EXAMPLE,
	},
	SbtcSummary: {
		type: "object",
		description: "All-time canonical totals for the sBTC bridge.",
		required: [
			"total_deposits",
			"total_withdrawals_requested",
			"total_withdrawals_accepted",
			"total_withdrawals_rejected",
			"net_peg_flow_sats",
			"total_locked_sats",
			"sbtc_supply_sats",
		],
		properties: {
			total_deposits: {
				type: "integer",
				description: "`completed-deposit` events.",
			},
			total_withdrawals_requested: {
				type: "integer",
				description: "`withdrawal-create` events.",
			},
			total_withdrawals_accepted: {
				type: "integer",
				description: "`withdrawal-accept` events.",
			},
			total_withdrawals_rejected: {
				type: "integer",
				description: "`withdrawal-reject` events.",
			},
			net_peg_flow_sats: {
				type: "string",
				description:
					"Sats deposited minus the `amount` on accept events, as a decimal string. An accept with no amount counts as 0, and mainnet accepts carry none, so today this equals total deposited.",
			},
			total_locked_sats: {
				type: "string",
				description: "Same figure as `net_peg_flow_sats`.",
			},
			sbtc_supply_sats: {
				type: ["string", "null"],
				description:
					"Circulating sBTC in sats, read from `sbtc-token` `get-total-supply` on this instance's node. Null when `STACKS_NODE_RPC_URL` is unset or the node does not answer.",
			},
		},
		// A real read: mainnet, 2026-09-23.
		example: SBTC_SUMMARY_EXAMPLE,
	},
};
