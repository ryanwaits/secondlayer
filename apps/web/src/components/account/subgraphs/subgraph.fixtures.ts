import type {
	SubgraphColumn,
	SubgraphDetailData,
	SubgraphErrorGroup,
	SubgraphHealthData,
	SubgraphListItem,
} from "@/lib/subgraphs-store";

/** Example subgraphs for tests, the lab and visual checks. Names and values
 *  are invented; nothing here is account data. */

const C32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const HEX = "0123456789abcdef";

/** A small deterministic generator so fixtures are stable across runs. */
function sequence(seed: number) {
	let s = seed;
	return () => {
		s = (s * 16807) % 2147483647;
		return s / 2147483647;
	};
}

export const EXAMPLE_NOW = Date.parse("2026-10-15T12:00:00Z");

export const exampleColumns: Record<string, SubgraphColumn> = {
	kind: { type: "text", indexed: true },
	sender: { type: "principal", nullable: true },
	recipient: { type: "principal", nullable: true, indexed: true },
	amount: { type: "uint" },
	_id: { type: "serial" },
	_block_height: { type: "bigint" },
	_tx_id: { type: "text" },
	_created_at: { type: "timestamp" },
};

export function exampleRows(count = 25): Record<string, unknown>[] {
	const next = sequence(42);
	const text = (alphabet: string, length: number) =>
		Array.from(
			{ length },
			() => alphabet[Math.floor(next() * alphabet.length)],
		).join("");
	const people = Array.from({ length: 6 }, () => `SP${text(C32, 38)}`);
	const pick = () => people[Math.floor(next() * people.length)] ?? null;
	const tip = 9_218_411;
	return Array.from({ length: count }, (_, i) => {
		const roll = next();
		const kind = roll < 0.7 ? "transfer" : roll < 0.85 ? "mint" : "burn";
		return {
			_id: 412_880 - i,
			_block_height: tip - Math.floor(i / 2),
			kind,
			sender: kind === "mint" ? null : pick(),
			recipient: kind === "burn" ? null : pick(),
			amount: String(Math.round(next() ** 2.4 * 4e5) * 100 + 1000),
			_tx_id: `0x${text(HEX, 64)}`,
			_created_at: new Date(EXAMPLE_NOW - i * 20_000).toISOString(),
		};
	});
}

export const exampleDetail: SubgraphDetailData = {
	name: "sbtc-deposits",
	version: "3.0.0",
	status: "active",
	lastProcessedBlock: 9_218_411,
	health: { totalProcessed: 1_204_113, totalErrors: 0, lastError: null },
	sync: { status: "synced", blocksRemaining: 1, chainTip: 9_218_412 },
	storageBytes: 1_200_000_000,
	tables: {
		transfers: {
			endpoint: "/v1/subgraphs/sbtc-deposits/transfers",
			columns: exampleColumns,
			rowCount: 412_880,
			indexes: [["kind"], ["recipient"]],
		},
		holders: {
			endpoint: "/v1/subgraphs/sbtc-deposits/holders",
			columns: {
				principal: { type: "principal" },
				balance: { type: "uint" },
				_id: { type: "serial" },
				_block_height: { type: "bigint" },
				_tx_id: { type: "text" },
				_created_at: { type: "timestamp" },
			},
			rowCount: 31_077,
		},
	},
	createdAt: "2026-09-01T09:00:00Z",
	updatedAt: "2026-10-15T11:59:40Z",
};

export function exampleHealth(errors24h = 0): SubgraphHealthData {
	const hours = Array.from({ length: 24 }, (_, i) => ({
		hour: new Date(EXAMPLE_NOW - (23 - i) * 3_600_000).toISOString(),
		lagBlocks: i === 6 ? 140 : i === 7 ? 38 : i === 8 ? 6 : i % 3,
		rowsWritten: i === 6 ? 0 : 640 + ((i * 97) % 180),
		errors: i === 20 ? errors24h : 0,
		eventsHandled: 900,
	}));
	return { hours, errors24h };
}

export const exampleErrors: SubgraphErrorGroup[] = [
	{
		message: "Cannot read properties of null (reading 'recipient')",
		frame: "handlers.ts:41",
		eventType: "ft_burn",
		sourceName: "sbtc-token",
		count: 3,
		sampleTxId: `0x${"ab".repeat(32)}`,
		sampleBlockHeight: 9_218_390,
		firstSeen: "2026-10-15T08:02:00Z",
		lastSeen: "2026-10-15T10:30:00Z",
	},
];

export const exampleList: SubgraphListItem[] = [
	{
		name: "sbtc-deposits",
		version: "3.0.0",
		status: "active",
		lastProcessedBlock: 9_218_411,
		totalRows: 443_957,
		totalErrors: 0,
		tables: ["transfers", "holders"],
		blocksRemaining: 1,
		updatedAt: "2026-10-15T11:59:40Z",
		createdAt: "2026-09-01T09:00:00Z",
	},
	{
		name: "vault-events",
		version: "1.2.0",
		status: "active",
		lastProcessedBlock: 9_218_300,
		totalRows: 1_204,
		totalErrors: 3,
		tables: ["events"],
		blocksRemaining: 112,
		updatedAt: "2026-10-15T11:40:00Z",
		createdAt: "2026-10-01T09:00:00Z",
	},
];

/** The founder's real `perf-test-sbtc` subgraph source, verbatim. */
export const PERF_TEST_SBTC_SOURCE = `import { defineSubgraph } from '@secondlayer/subgraphs';

// \`prints\` below is INFERRED from 2000 sampled on-chain events, blocks 328312–9405901.
// It is the shape observed, not a guarantee: a field absent from the sample may
// still occur, and a contract upgrade can invalidate it. Declaring \`prints\`
// also enables runtime validation — a mismatching event is skipped and logged.

export default defineSubgraph({
	name: 'perf-test-sbtc',
	// Recent height, skips history. A lower start block backfills more.
	startBlock: 1,
	sources: {
		completedDeposit: {
			type: 'print_event',
			contractId: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
			topic: 'completed-deposit',
			prints: {
				'completed-deposit': {
					amount: 'uint',
					bitcoinTxid: 'text',
					burnHash: 'text',
					burnHeight: 'uint',
					outputIndex: 'uint',
					sweepTxid: 'text',
				},
			},
		},
		withdrawalCreate: {
			type: 'print_event',
			contractId: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
			topic: 'withdrawal-create',
			prints: {
				'withdrawal-create': {
					amount: 'uint',
					blockHeight: 'uint',
					maxFee: 'uint',
					recipient: 'jsonb',
					requestId: 'uint',
					sender: 'principal',
				},
			},
		},
		withdrawalAccept: {
			type: 'print_event',
			contractId: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
			topic: 'withdrawal-accept',
			prints: {
				'withdrawal-accept': {
					bitcoinTxid: 'text',
					burnHash: 'text',
					burnHeight: 'uint',
					fee: 'uint',
					outputIndex: 'uint',
					requestId: 'uint',
					signerBitmap: 'uint',
					sweepTxid: 'text',
				},
			},
		},
		withdrawalReject: {
			type: 'print_event',
			contractId: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
			topic: 'withdrawal-reject',
			prints: {
				'withdrawal-reject': {
					requestId: 'uint',
					signerBitmap: 'uint',
				},
			},
		},
		keyRotation: {
			type: 'print_event',
			contractId: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
			topic: 'key-rotation',
			prints: {
				'key-rotation': {
					newAddress: 'principal',
					newAggregatePubkey: 'text',
					newKeys: 'jsonb',
					newSignatureThreshold: 'uint',
				},
			},
		},
	},
	schema: {
		completed_deposit: {
			columns: {
				amount: { type: 'uint' },
				bitcoin_txid: { type: 'text' },
				burn_hash: { type: 'text' },
				burn_height: { type: 'uint' },
				output_index: { type: 'uint' },
				sweep_txid: { type: 'text' },
			},
		},
		withdrawal_create: {
			columns: {
				amount: { type: 'uint' },
				block_height: { type: 'uint' },
				max_fee: { type: 'uint' },
				recipient: { type: 'jsonb' },
				request_id: { type: 'uint' },
				sender: { type: 'principal' },
			},
		},
		withdrawal_accept: {
			columns: {
				bitcoin_txid: { type: 'text' },
				burn_hash: { type: 'text' },
				burn_height: { type: 'uint' },
				fee: { type: 'uint' },
				output_index: { type: 'uint' },
				request_id: { type: 'uint' },
				signer_bitmap: { type: 'uint' },
				sweep_txid: { type: 'text' },
			},
		},
		withdrawal_reject: {
			columns: {
				request_id: { type: 'uint' },
				signer_bitmap: { type: 'uint' },
			},
		},
		key_rotation: {
			columns: {
				new_address: { type: 'principal' },
				new_aggregate_pubkey: { type: 'text' },
				new_keys: { type: 'jsonb' },
				new_signature_threshold: { type: 'uint' },
			},
		},
	},
	handlers: {
		completedDeposit: (event, ctx) => {
			ctx.insert('completed_deposit', {
				amount: event.data.amount,
				bitcoin_txid: event.data.bitcoinTxid,
				burn_hash: event.data.burnHash,
				burn_height: event.data.burnHeight,
				output_index: event.data.outputIndex,
				sweep_txid: event.data.sweepTxid,
			});
		},

		withdrawalCreate: (event, ctx) => {
			ctx.insert('withdrawal_create', {
				amount: event.data.amount,
				block_height: event.data.blockHeight,
				max_fee: event.data.maxFee,
				recipient: event.data.recipient,
				request_id: event.data.requestId,
				sender: event.data.sender,
			});
		},

		withdrawalAccept: (event, ctx) => {
			ctx.insert('withdrawal_accept', {
				bitcoin_txid: event.data.bitcoinTxid,
				burn_hash: event.data.burnHash,
				burn_height: event.data.burnHeight,
				fee: event.data.fee,
				output_index: event.data.outputIndex,
				request_id: event.data.requestId,
				signer_bitmap: event.data.signerBitmap,
				sweep_txid: event.data.sweepTxid,
			});
		},

		withdrawalReject: (event, ctx) => {
			ctx.insert('withdrawal_reject', {
				request_id: event.data.requestId,
				signer_bitmap: event.data.signerBitmap,
			});
		},

		keyRotation: (event, ctx) => {
			ctx.insert('key_rotation', {
				new_address: event.data.newAddress,
				new_aggregate_pubkey: event.data.newAggregatePubkey,
				new_keys: event.data.newKeys,
				new_signature_threshold: event.data.newSignatureThreshold,
			});
		},
	},
});
`;

/** Three real rows per table, newest first. */
export const PERF_TEST_SBTC_ROWS: Record<string, Record<string, unknown>[]> = {
	completed_deposit: [
		{
			_id: "63194",
			_block_height: "9406147",
			_tx_id:
				"0x28b38a37ec1c0a2913ff5e0051fdfc5038ead96e90b6f5d7b05f4bc0d3de3e45",
			_created_at: "2026-11-03T19:49:38.682Z",
			amount: "94847",
			bitcoin_txid:
				"0x53d9fe43505618ffc56c8ddf945d33831a95ce2ff8bfffbc430f4980ec4141cb",
			burn_hash:
				"0x00000000000000000001db4903c671a16320b1ef2e0597cdc5cd60d5bf0a7ae1",
			burn_height: "974430",
			output_index: "1",
			sweep_txid:
				"0x5ae0392fb7d4de562c8903a95a3771be5095cb7f1bc6444af136f5cf9c7198b3",
		},
		{
			_id: "63193",
			_block_height: "9406147",
			_tx_id:
				"0x1b5ba4c3a6f24b0c3832bb1a2fc04c95def058a7c6f559735ce99cd7b662a261",
			_created_at: "2026-11-03T19:49:38.682Z",
			amount: "74847",
			bitcoin_txid:
				"0xfd0c2167deecd1dab40a66c67ff1c41aac368eff22d87ff69e7322be696ad730",
			burn_hash:
				"0x00000000000000000001db4903c671a16320b1ef2e0597cdc5cd60d5bf0a7ae1",
			burn_height: "974430",
			output_index: "1",
			sweep_txid:
				"0x5ae0392fb7d4de562c8903a95a3771be5095cb7f1bc6444af136f5cf9c7198b3",
		},
		{
			_id: "63192",
			_block_height: "9406147",
			_tx_id:
				"0x6167ba039e05399b381553790d1dad3aa5fc81152c4968e61923949af08ec5b0",
			_created_at: "2026-11-03T19:49:38.682Z",
			amount: "19847",
			bitcoin_txid:
				"0x72cd88a1b9344ba5c1de73ec76e21b30e79b471b11d488ff518e171570c6f05e",
			burn_hash:
				"0x00000000000000000001db4903c671a16320b1ef2e0597cdc5cd60d5bf0a7ae1",
			burn_height: "974430",
			output_index: "1",
			sweep_txid:
				"0x5ae0392fb7d4de562c8903a95a3771be5095cb7f1bc6444af136f5cf9c7198b3",
		},
	],
	withdrawal_create: [
		{
			_id: "4810",
			_block_height: "9405811",
			_tx_id:
				"0x32687eb9307d28fd56d9f6541add4ac04331c1aa313e65600e6bb44f0a1c485e",
			_created_at: "2026-11-03T19:44:36.443Z",
			amount: "10267",
			block_height: "974423",
			max_fee: "750",
			recipient: {
				version: "0x04",
				hashbytes: "0x8f3a7dc5cc696bc9eec74357c0c1341ad2e47d34",
			},
			request_id: "4810",
			sender: "SP3GPP2G9YERWMKFQ51VCE7P7ZGKQPJ0YWNGEVZRB",
		},
		{
			_id: "4809",
			_block_height: "9405802",
			_tx_id:
				"0xf122e7e8a9e59f395c52c0ae8ae7916197bfcc0b73a18a22f9c1abad0243979a",
			_created_at: "2026-11-03T19:44:36.438Z",
			amount: "329956",
			block_height: "974423",
			max_fee: "1600",
			recipient: {
				version: "0x04",
				hashbytes: "0xa7eb0a92b8f295d8175e5810d587979fe5232d4a",
			},
			request_id: "4809",
			sender: "SPMPRCM6FYB9TJPHDBY62TZCY7F1ZS2H3CJYE77H",
		},
		{
			_id: "4808",
			_block_height: "9405438",
			_tx_id:
				"0xb4f0c00abc824ee9a9b54a9727feaf8ca0b12a837cf8f69df98fac5569eaff66",
			_created_at: "2026-11-03T19:44:36.390Z",
			amount: "8950",
			block_height: "974417",
			max_fee: "5000",
			recipient: {
				version: "0x04",
				hashbytes: "0xca58a2971acce9222d88838987a2e42b6e5618d0",
			},
			request_id: "4808",
			sender: "SP14R50NS6J0TZYQC1DKWHPGC9HERWDK7R3XV54NH",
		},
	],
	withdrawal_accept: [
		{
			_id: "4514",
			_block_height: "9405901",
			_tx_id:
				"0x814411193bfb0e56d6ba96ab6dbe72fcc472b760f827f741547af6db404ae7d3",
			_created_at: "2026-11-03T19:44:36.469Z",
			bitcoin_txid:
				"0xc21d1f68d087299308f67056e2b278bcb8b6fed099b3f7819d0f9a4c657da417",
			burn_hash:
				"0x000000000000000000016c9e8264dfa8202f629a73954f18d8dbee40239d985f",
			burn_height: "974428",
			fee: "83",
			output_index: "2",
			request_id: "4808",
			signer_bitmap: "0",
			sweep_txid:
				"0xc21d1f68d087299308f67056e2b278bcb8b6fed099b3f7819d0f9a4c657da417",
		},
		{
			_id: "4513",
			_block_height: "9405398",
			_tx_id:
				"0x8e39bb46b421643d94c5dacdd37af09d8acdd28207ed1aea0cf9e3af02081d50",
			_created_at: "2026-11-03T19:44:36.370Z",
			bitcoin_txid:
				"0x8cfaacfec2fd1a1689c53471741ca6de4b75b430a5d91c0d466a7627184d63c3",
			burn_hash:
				"0x00000000000000000000b0a7c21881ecbb9849b21c83f57df2341a5f58e99635",
			burn_height: "974414",
			fee: "99",
			output_index: "2",
			request_id: "4806",
			signer_bitmap: "0",
			sweep_txid:
				"0x8cfaacfec2fd1a1689c53471741ca6de4b75b430a5d91c0d466a7627184d63c3",
		},
		{
			_id: "4512",
			_block_height: "9404655",
			_tx_id:
				"0xc14d4bf7eb43ad8df6e37e805007fa0cb21eb7572be2f11ac4a0ced101cbbd70",
			_created_at: "2026-11-03T19:44:36.015Z",
			bitcoin_txid:
				"0x63b17dc5ab53f26bb4c31ecbb51cb0f5879d10763d66b8d3c2ea669ac0b6d4e4",
			burn_hash:
				"0x000000000000000000003571cce136319005e44e8b8a87895c739e135456ea8a",
			burn_height: "974393",
			fee: "83",
			output_index: "2",
			request_id: "4805",
			signer_bitmap: "0",
			sweep_txid:
				"0x63b17dc5ab53f26bb4c31ecbb51cb0f5879d10763d66b8d3c2ea669ac0b6d4e4",
		},
	],
	withdrawal_reject: [
		{
			_id: "293",
			_block_height: "9400652",
			_tx_id:
				"0x40c6f22b1c4fe783b522a36fb3156a994e3790ed3fdf64c305806dbe6193f456",
			_created_at: "2026-11-03T19:44:35.390Z",
			request_id: "4799",
			signer_bitmap: "0",
		},
		{
			_id: "292",
			_block_height: "9400457",
			_tx_id:
				"0xf61b0b922b5408bae8bff26459d29f92b405bc463d0f31cf5188661feaf02562",
			_created_at: "2026-11-03T19:44:35.357Z",
			request_id: "4798",
			signer_bitmap: "0",
		},
		{
			_id: "291",
			_block_height: "9398500",
			_tx_id:
				"0xf89bd727e3b6e7270b81b640e4f42392b209afce57decb5591efd0e5b8a3e4e3",
			_created_at: "2026-11-03T19:44:35.036Z",
			request_id: "4793",
			signer_bitmap: "0",
		},
	],
	key_rotation: [
		{
			_id: "8",
			_block_height: "9199197",
			_tx_id:
				"0x6cba74af754c11bcc3ce7f8e94db632e26960210906039290d4e6a795ab33aa7",
			_created_at: "2026-11-03T19:43:54.113Z",
			new_address: "SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8",
			new_aggregate_pubkey:
				"0x02d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69",
			new_keys: [
				"0x024e8daf0693ad298802462873bcb3b29d2cd4eb001c55dd58dea6a004d737770d",
				"0x02ce1efe968185ca9373fe0fce9e4d1a302d560201b549593830ca54f115318b9c",
				"0x031ceed24212c17b55088e0d0478e1445bb3714df22cfc2564180150a2a10a9bcd",
				"0x03431638d7656f2b313776ab8e5fbffb994e0635cb53965d33cdb819384400286f",
				"0x0368d6742af52b9f7069570da3bdba120f7e760ea31c4bc0e5b96bba7a70f4d317",
				"0x038fc9219584885958632f230f28ed71759a4df14684006e7185f4ab2e2938c7d2",
				"0x0392d42b60390f4b1c64c1972bd1bb992cb669dd556c74ef1d8897438d80909ab9",
				"0x03b5b8b594438c7101bbc5fb25d1b76c4643c713481031f7d06bde1f1668c8112d",
				"0x03d92e4ee96a6046c1ffb054b776631fc631b987819c98ecd2e97c79bd887fc24a",
				"0x03e18e1a807e76d307e78e4d8ef579871e4ee7ad6362c69bc3a4d002925bac1f05",
				"0x03ed8edbcbb26010ae3a992ea1e4fffab3805e1303edbd3c130307b4cbcd38a481",
			],
			new_signature_threshold: "8",
		},
		{
			_id: "7",
			_block_height: "8832017",
			_tx_id:
				"0x81b9176ef0da2e227e918386f63349129f3869181db6780ec6fc75217879df00",
			_created_at: "2026-11-03T19:42:33.914Z",
			new_address: "SM1FD0VVN9MJE04PTGM241S3CEY0JZQHC161P9KJ8",
			new_aggregate_pubkey:
				"0x033920f589c2b367400732d2dd61d11b300ad95b2b1bbf008eabcf8cddfee0c12c",
			new_keys: [
				"0x024676bcd2affe0460dcd999c2ab4a31d6967046707db4d973c4fb395cb0841c62",
				"0x024e8daf0693ad298802462873bcb3b29d2cd4eb001c55dd58dea6a004d737770d",
				"0x02ce1efe968185ca9373fe0fce9e4d1a302d560201b549593830ca54f115318b9c",
				"0x03431638d7656f2b313776ab8e5fbffb994e0635cb53965d33cdb819384400286f",
				"0x035b1c31ee3412fb5e7e4c510b957689c6f30ab591082c425c58af77d6e593d7f1",
				"0x0368d6742af52b9f7069570da3bdba120f7e760ea31c4bc0e5b96bba7a70f4d317",
				"0x038fc9219584885958632f230f28ed71759a4df14684006e7185f4ab2e2938c7d2",
				"0x0392d42b60390f4b1c64c1972bd1bb992cb669dd556c74ef1d8897438d80909ab9",
				"0x03b5b8b594438c7101bbc5fb25d1b76c4643c713481031f7d06bde1f1668c8112d",
				"0x03d92e4ee96a6046c1ffb054b776631fc631b987819c98ecd2e97c79bd887fc24a",
				"0x03ed8edbcbb26010ae3a992ea1e4fffab3805e1303edbd3c130307b4cbcd38a481",
			],
			new_signature_threshold: "8",
		},
		{
			_id: "6",
			_block_height: "8647084",
			_tx_id:
				"0xe4bfbe64d53fbba34c26c901ec250ac4a55c83045288e7ddba3f91dae3d3bc4c",
			_created_at: "2026-11-03T19:42:00.813Z",
			new_address: "SM3PT9TDBRKSNYBB7YM3VN9MVENCFERJJPAZTJFRZ",
			new_aggregate_pubkey:
				"0x03888584b61d3566636cf548e4eecc689cd23c7eb339b86d243b1aa4afee33238a",
			new_keys: [
				"0x024e8daf0693ad298802462873bcb3b29d2cd4eb001c55dd58dea6a004d737770d",
				"0x02ce1efe968185ca9373fe0fce9e4d1a302d560201b549593830ca54f115318b9c",
				"0x03431638d7656f2b313776ab8e5fbffb994e0635cb53965d33cdb819384400286f",
				"0x035b1c31ee3412fb5e7e4c510b957689c6f30ab591082c425c58af77d6e593d7f1",
				"0x0368d6742af52b9f7069570da3bdba120f7e760ea31c4bc0e5b96bba7a70f4d317",
				"0x03830690830ab2790433231521edbad02715ce7d8b6a8aa43f83cad3e2407b96c4",
				"0x0396559be1e9b88988237fb7f92f7f2b81b7f644718fc3170e3bf45d703f05e490",
				"0x03b5b8b594438c7101bbc5fb25d1b76c4643c713481031f7d06bde1f1668c8112d",
				"0x03b767388de2f11326cd2c44ac2032f5bf8fcf8572b46cfff0057c5e1c5c0bd7d6",
				"0x03d92e4ee96a6046c1ffb054b776631fc631b987819c98ecd2e97c79bd887fc24a",
				"0x03ed8edbcbb26010ae3a992ea1e4fffab3805e1303edbd3c130307b4cbcd38a481",
			],
			new_signature_threshold: "8",
		},
	],
};

const PERF_TEST_SBTC_ROW_COUNTS: Record<string, number> = {
	completed_deposit: 63_194,
	withdrawal_create: 4_810,
	withdrawal_accept: 4_514,
	withdrawal_reject: 293,
	key_rotation: 8,
};

const PERF_TEST_SBTC_TOPICS: Record<string, string> = {
	completedDeposit: "completed-deposit",
	withdrawalCreate: "withdrawal-create",
	withdrawalAccept: "withdrawal-accept",
	withdrawalReject: "withdrawal-reject",
	keyRotation: "key-rotation",
};

/** The detail response for the real subgraph above: five tables and five print sources. */
export const perfTestSbtcDetail: SubgraphDetailData = {
	name: "perf-test-sbtc",
	version: "1.0.0",
	status: "active",
	lastProcessedBlock: 9_406_147,
	health: { totalProcessed: 72_819, totalErrors: 0, lastError: null },
	sync: { status: "synced", blocksRemaining: 0, chainTip: 9_406_147 },
	storageBytes: 31_000_000,
	tables: Object.fromEntries(
		Object.entries(PERF_TEST_SBTC_ROW_COUNTS).map(([table, rowCount]) => {
			const sample = PERF_TEST_SBTC_ROWS[table]?.[0] ?? {};
			return [
				table,
				{
					endpoint: `/v1/subgraphs/perf-test-sbtc/${table}`,
					rowCount,
					columns: Object.fromEntries(
						Object.keys(sample).map((column) => [column, { type: "text" }]),
					),
				},
			];
		}),
	),
	sources: Object.fromEntries(
		Object.entries(PERF_TEST_SBTC_TOPICS).map(([key, topic]) => [
			key,
			{
				type: "print_event",
				contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
				topic,
			},
		]),
	),
	createdAt: "2026-11-03T17:00:00Z",
	updatedAt: "2026-11-03T19:50:00Z",
};
