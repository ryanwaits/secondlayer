import { PLATFORM_API_URL } from "@/lib/api";
import { type DataTopic, liveDataUrl } from "@/lib/data-topics";
import { SITE } from "@/lib/docs-agent";

/**
 * Live numbers for the /data/sbtc and /data/pox5 pages, from the keyless
 * `/public/data/*` aggregates (the web app holds no server key). Every read
 * returns `null` on any failure so the page falls back to the API pitch alone.
 */

const TIMEOUT_MS = 4_000;
const REVALIDATE_SECONDS = 60;

export type SbtcStats = {
	supplyBtc: number;
	deposits: number;
	withdrawalsAccepted: number;
	withdrawalsRejected: number;
	blockHeight: number;
	generatedAt: string;
};

export type SignerRow = {
	/** Full principal, shown on hover. */
	principal: string;
	/** Contract name, or a shortened principal when it has none. */
	name: string;
	stackedStx: number;
	/** Percent of the cycle's total stacked, one decimal. */
	sharePct: number;
	inSet: boolean;
};

export type PoxStats = {
	cycle: number;
	endBurnHeight: number;
	totalStackedStx: number;
	stakers: number;
	signersInSet: number;
	bondBtc: number;
	signers: SignerRow[];
	blockHeight: number;
	generatedAt: string;
};

/** Whole STX from a micro-STX decimal string. */
export function ustxToStx(ustx: string): number {
	return Number(BigInt(ustx) / 1_000_000n);
}

export function satsToBtc(sats: string): number {
	return Number(sats) / 1e8;
}

/** Share of `total` in percent, one decimal; 0 when the total is empty. */
export function sharePct(part: string, total: string): number {
	const denominator = BigInt(total);
	if (denominator === 0n) return 0;
	return Number((BigInt(part) * 1000n) / denominator) / 10;
}

/** `meria-signer-manager` from `SP1N3G8….meria-signer-manager`. */
export function signerName(principal: string): string {
	const dot = principal.indexOf(".");
	if (dot !== -1 && dot < principal.length - 1) return principal.slice(dot + 1);
	return principal.length > 12
		? `${principal.slice(0, 6)}…${principal.slice(-4)}`
		: principal;
}

/**
 * Rows whose contract name is shared get the deployer appended
 * (`signer-manager · SP3…9A2F`); unique names stay as they are.
 */
export function tellSignersApart(rows: SignerRow[]): SignerRow[] {
	const seen = new Map<string, number>();
	for (const row of rows) seen.set(row.name, (seen.get(row.name) ?? 0) + 1);
	return rows.map((row) => {
		const dot = row.principal.indexOf(".");
		if ((seen.get(row.name) ?? 0) < 2 || dot === -1) return row;
		const deployer = row.principal.slice(0, dot);
		return {
			...row,
			name: `${row.name} · ${deployer.slice(0, 3)}…${deployer.slice(-4)}`,
		};
	});
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isDecimal = (value: unknown): value is string =>
	typeof value === "string" && /^\d+$/.test(value);
const isCount = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

/** The tip height and timestamp every payload carries, or null. */
function readStamp(
	body: Json,
): { blockHeight: number; generatedAt: string } | null {
	const tip = body.tip;
	const generatedAt = body.generated_at;
	if (!isObject(tip) || !isCount(tip.block_height)) return null;
	if (typeof generatedAt !== "string") return null;
	return { blockHeight: tip.block_height, generatedAt };
}

export function parseSbtcStats(body: unknown): SbtcStats | null {
	if (!isObject(body) || !isObject(body.summary)) return null;
	const stamp = readStamp(body);
	const s = body.summary;
	if (
		!stamp ||
		!isDecimal(s.sbtc_supply_sats) ||
		!isCount(s.total_deposits) ||
		!isCount(s.total_withdrawals_accepted) ||
		!isCount(s.total_withdrawals_rejected)
	)
		return null;
	return {
		supplyBtc: satsToBtc(s.sbtc_supply_sats),
		deposits: s.total_deposits,
		withdrawalsAccepted: s.total_withdrawals_accepted,
		withdrawalsRejected: s.total_withdrawals_rejected,
		...stamp,
	};
}

function parseSigner(raw: unknown, total: string): SignerRow | null {
	if (
		!isObject(raw) ||
		typeof raw.signer !== "string" ||
		!isDecimal(raw.delegated_ustx) ||
		typeof raw.in_set !== "boolean"
	)
		return null;
	return {
		principal: raw.signer,
		name: signerName(raw.signer),
		stackedStx: ustxToStx(raw.delegated_ustx),
		sharePct: sharePct(raw.delegated_ustx, total),
		inSet: raw.in_set,
	};
}

export function parsePoxStats(body: unknown): PoxStats | null {
	if (!isObject(body) || !isObject(body.current)) return null;
	const stamp = readStamp(body);
	const c = body.current;
	if (
		!stamp ||
		!isCount(c.reward_cycle) ||
		!isCount(c.end_burn_height) ||
		!isDecimal(c.total_stacked_ustx) ||
		!isCount(c.stakers) ||
		!isCount(c.signers_in_set) ||
		!isDecimal(c.bond_total_sats) ||
		!Array.isArray(body.signers)
	)
		return null;
	const total = c.total_stacked_ustx;
	const signers = body.signers.map((raw) => parseSigner(raw, total));
	if (signers.some((row) => row === null)) return null;
	return {
		cycle: c.reward_cycle,
		endBurnHeight: c.end_burn_height,
		totalStackedStx: ustxToStx(total),
		stakers: c.stakers,
		signersInSet: c.signers_in_set,
		bondBtc: satsToBtc(c.bond_total_sats),
		signers: tellSignersApart(signers as SignerRow[]),
		...stamp,
	};
}

async function fetchJson(path: "sbtc" | "pox"): Promise<unknown> {
	try {
		const res = await fetch(`${PLATFORM_API_URL}/public/data/${path}`, {
			next: { revalidate: REVALIDATE_SECONDS },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

export async function getSbtcStats(): Promise<SbtcStats | null> {
	return parseSbtcStats(await fetchJson("sbtc"));
}

export async function getPoxStats(): Promise<PoxStats | null> {
	return parsePoxStats(await fetchJson("pox"));
}

export type TopicStats =
	| { kind: "sbtc"; data: SbtcStats }
	| { kind: "pox"; data: PoxStats };

/** The live numbers for a topic, or null for a topic with none or on failure. */
export async function getTopicStats(
	topic: DataTopic,
): Promise<TopicStats | null> {
	if (topic.stats === "sbtc") {
		const data = await getSbtcStats();
		return data ? { kind: "sbtc", data } : null;
	}
	if (topic.stats === "pox") {
		const data = await getPoxStats();
		return data ? { kind: "pox", data } : null;
	}
	return null;
}

const count = new Intl.NumberFormat("en-US");
const btc = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** One real number in the meta description, so a crawl sees fresh text. */
export function liveDescription(
	topic: DataTopic,
	stats: TopicStats | null,
): string {
	if (!stats) return topic.description;
	if (stats.kind === "sbtc")
		return `${btc.format(stats.data.supplyBtc)} sBTC across ${count.format(stats.data.deposits)} deposits. Live supply, deposits and withdrawals, free, no key.`;
	return `${count.format(stats.data.totalStackedStx)} STX stacked in PoX-5 cycle ${stats.data.cycle} by ${count.format(stats.data.stakers)} stakers and ${stats.data.signersInSet} signers. Live, free, no key.`;
}

/** schema.org Dataset for the page, built at render time. */
export function datasetJsonLd(
	topic: DataTopic,
	stats: TopicStats,
	path: string,
): Record<string, unknown> {
	return {
		"@context": "https://schema.org",
		"@type": "Dataset",
		name: topic.title,
		description: liveDescription(topic, stats),
		url: `${SITE}${path}`,
		dateModified: stats.data.generatedAt,
		isAccessibleForFree: true,
		creator: {
			"@type": "Organization",
			name: "Secondlayer",
			url: SITE,
		},
		distribution: {
			"@type": "DataDownload",
			encodingFormat: "application/json",
			contentUrl: liveDataUrl(stats.kind),
		},
	};
}

export type StripItem = {
	label: string;
	value: number;
	/** Unit after the number: "BTC", "STX". */
	unit?: string;
	/** Fraction digits to show. */
	decimals: number;
};

/** The four big numbers for a topic, plus the line under the cycle. */
export function stripItems(stats: TopicStats): {
	items: StripItem[];
	sub: string | null;
} {
	if (stats.kind === "sbtc") {
		const d = stats.data;
		return {
			items: [
				{ label: "sBTC supply", value: d.supplyBtc, unit: "BTC", decimals: 2 },
				{ label: "Deposits", value: d.deposits, decimals: 0 },
				{
					label: "Withdrawals accepted",
					value: d.withdrawalsAccepted,
					decimals: 0,
				},
				{
					label: "Withdrawals rejected",
					value: d.withdrawalsRejected,
					decimals: 0,
				},
			],
			sub: null,
		};
	}
	const d = stats.data;
	return {
		items: [
			{
				label: "Total stacked",
				value: d.totalStackedStx,
				unit: "STX",
				decimals: 0,
			},
			{ label: "Stakers", value: d.stakers, decimals: 0 },
			{ label: "Signers in set", value: d.signersInSet, decimals: 0 },
			{ label: "Bonded", value: d.bondBtc, unit: "BTC", decimals: 2 },
		],
		sub: `Cycle ${d.cycle} · ends at Bitcoin block ${count.format(d.endBurnHeight)}`,
	};
}
