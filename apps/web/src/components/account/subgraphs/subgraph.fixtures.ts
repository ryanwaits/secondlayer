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
