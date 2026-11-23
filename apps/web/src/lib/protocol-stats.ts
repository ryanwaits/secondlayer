import { PLATFORM_API_URL } from "@/lib/api";
import {
	CYCLE_TOKEN,
	type DataExample,
	type DataTopic,
	FALLBACK_CYCLE,
	liveDataUrl,
} from "@/lib/data-topics";
import { SITE } from "@/lib/docs-agent";

/**
 * Live numbers for the /data/sbtc, /data/pox5 and /data/runes pages, from the keyless
 * `/public/data/*` aggregates (the web app holds no server key). Every read
 * returns `null` on any failure so the page falls back to the API pitch alone.
 */

const TIMEOUT_MS = 4_000;
const REVALIDATE_SECONDS = 60;

export type SbtcStats = {
	/** `.summary` as the API sent it, so the page's `jq .summary` output matches. */
	summary: Record<string, unknown>;
	supplyBtc: number;
	deposits: number;
	withdrawalsAccepted: number;
	withdrawalsRejected: number;
	blockHeight: number;
	generatedAt: string;
};

export type SignerRow = {
	principal: string;
	name: string;
	stackedStx: number;
	sharePct: number;
	inSet: boolean;
};

export type PoxStats = {
	cycle: number;
	totalStackedUstx: string;
	endBurnHeight: number;
	totalStackedStx: number;
	stakers: number;
	signersInSet: number;
	bondBtc: number;
	signers: SignerRow[];
	blockHeight: number;
	generatedAt: string;
};

export type RuneRow = {
	id: string;
	name: string;
	symbol: string | null;
	/** Decimal strings: u128 amounts never pass through `Number`. */
	mints: string;
	supply: string;
	divisibility: number;
};

export type RunesStats = {
	runes: RuneRow[];
	/** Bitcoin block height, not Stacks. */
	blockHeight: number;
	generatedAt: string;
};

export function ustxToStx(ustx: string): number {
	return Number(BigInt(ustx) / 1_000_000n);
}

export function satsToBtc(sats: string): number {
	return Number(sats) / 1e8;
}

export function sharePct(part: string, total: string): number {
	const denominator = BigInt(total);
	if (denominator === 0n) return 0;
	return Number((BigInt(part) * 1000n) / denominator) / 10;
}

export function signerName(principal: string): string {
	const dot = principal.indexOf(".");
	if (dot !== -1 && dot < principal.length - 1) return principal.slice(dot + 1);
	return principal.length > 12
		? `${principal.slice(0, 6)}…${principal.slice(-4)}`
		: principal;
}

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
		summary: s,
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
		totalStackedUstx: total,
		endBurnHeight: c.end_burn_height,
		totalStackedStx: ustxToStx(total),
		stakers: c.stakers,
		signersInSet: c.signers_in_set,
		bondBtc: satsToBtc(c.bond_total_sats),
		signers: tellSignersApart(signers as SignerRow[]),
		...stamp,
	};
}

export function runeSymbol(symbol: string | null): string {
	return symbol || "¤";
}

function parseRune(raw: unknown): RuneRow | null {
	if (
		!isObject(raw) ||
		typeof raw.id !== "string" ||
		typeof raw.spaced_name !== "string" ||
		!(raw.symbol === null || typeof raw.symbol === "string") ||
		!isDecimal(raw.mints) ||
		!isDecimal(raw.supply) ||
		!isCount(raw.divisibility)
	)
		return null;
	return {
		id: raw.id,
		name: raw.spaced_name,
		symbol: raw.symbol,
		mints: raw.mints,
		supply: raw.supply,
		divisibility: raw.divisibility,
	};
}

export function parseRunesStats(body: unknown): RunesStats | null {
	if (!isObject(body) || !Array.isArray(body.most_minted)) return null;
	const stamp = readStamp(body);
	if (!stamp || body.most_minted.length === 0) return null;
	const runes = body.most_minted.map(parseRune);
	if (runes.some((row) => row === null)) return null;
	return { runes: runes as RuneRow[], ...stamp };
}

async function fetchJson(path: "sbtc" | "pox" | "runes"): Promise<unknown> {
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

export async function getRunesStats(): Promise<RunesStats | null> {
	return parseRunesStats(await fetchJson("runes"));
}

export type TopicStats =
	| { kind: "sbtc"; data: SbtcStats }
	| { kind: "pox"; data: PoxStats }
	| { kind: "runes"; data: RunesStats };

export type StripStats = Exclude<TopicStats, { kind: "runes" }>;

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
	const data = await getRunesStats();
	return data ? { kind: "runes", data } : null;
}

const count = new Intl.NumberFormat("en-US");
const btc = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function liveDescription(
	topic: DataTopic,
	stats: TopicStats | null,
): string {
	if (!stats) return topic.description;
	if (stats.kind === "sbtc")
		return `${btc.format(stats.data.supplyBtc)} sBTC across ${count.format(stats.data.deposits)} deposits. Live supply, deposits and withdrawals, free, no key.`;
	if (stats.kind === "runes") {
		const [top] = stats.data.runes;
		return `${top?.name ?? "Runes"} leads Bitcoin runes with ${count.format(Number(top?.mints ?? 0))} mints. Live most-minted runes, free, no key.`;
	}
	return `${count.format(stats.data.totalStackedStx)} STX stacked in PoX-5 cycle ${stats.data.cycle} by ${count.format(stats.data.stakers)} stakers and ${stats.data.signersInSet} signers. Live, free, no key.`;
}

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
		license: "https://creativecommons.org/licenses/by/4.0/",
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
	unit?: string;
	decimals: number;
};

export function stripItems(stats: StripStats): {
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

export function formatRuneAmount(raw: string, divisibility: number): string {
	const scale = 10n ** BigInt(divisibility);
	const amount = BigInt(raw);
	const whole = new Intl.NumberFormat("en-US").format(amount / scale);
	const fraction = (amount % scale)
		.toString()
		.padStart(divisibility, "0")
		.replace(/0+$/, "");
	return fraction ? `${whole}.${fraction}` : whole;
}

function jsonWithMark(
	value: Record<string, unknown>,
	key: string,
	mark: string,
): string {
	return JSON.stringify(value, null, 2)
		.split("\n")
		.flatMap((line) =>
			line.trimStart().startsWith(`"${key}":`)
				? [`${/^\s*/.exec(line)?.[0]}// !mark[/${mark}/]`, line]
				: [line],
		)
		.join("\n");
}

export function liveOutput(stats: TopicStats): string {
	if (stats.kind === "sbtc") {
		const sats = String(stats.data.summary.sbtc_supply_sats);
		return jsonWithMark(stats.data.summary, "sbtc_supply_sats", sats);
	}
	if (stats.kind === "pox") {
		const d = stats.data;
		return jsonWithMark(
			{
				reward_cycle: d.cycle,
				total_stacked_ustx: d.totalStackedUstx,
				stakers: d.stakers,
			},
			"total_stacked_ustx",
			d.totalStackedUstx,
		);
	}
	const top = stats.data.runes[0];
	if (!top) return "null";
	return jsonWithMark(
		{
			id: top.id,
			spaced_name: top.name,
			symbol: top.symbol,
			mints: top.mints,
			supply: top.supply,
			divisibility: top.divisibility,
		},
		"mints",
		top.mints,
	);
}

export function liveExamples(
	topic: DataTopic,
	stats: TopicStats | null,
): DataTopic["examples"] {
	const cycle = String(
		stats?.kind === "pox" ? stats.data.cycle : FALLBACK_CYCLE,
	);
	const fill = (example: DataExample): DataExample => ({
		code: example.code.replaceAll(CYCLE_TOKEN, cycle),
		output: example.output.replaceAll(CYCLE_TOKEN, cycle),
	});
	const { free, ts, curl } = topic.examples;
	return {
		free: stats ? { ...fill(free), output: liveOutput(stats) } : fill(free),
		ts: fill(ts),
		curl: fill(curl),
	};
}

export const outputLang = (output: string): "json" | "text" =>
	/^[[{]/.test(output.trimStart()) ? "json" : "text";
