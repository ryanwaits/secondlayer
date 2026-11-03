import type {
	DeliveryRow,
	WebhookActivity,
	WebhookDetail,
} from "@secondlayer/sdk";

/**
 * Example account behind the dashboard preview on /docs/mcp. The kit draws it
 * exactly as it draws a real account: these are the bodies the read-only
 * proxy would return. Example names and receivers only, never real data.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type Hook = {
	id: string;
	name: string;
	url: string;
	triggers: WebhookDetail["triggers"];
	/** Deliveries per day, before the wobble. */
	perDay: number;
	event: (i: number) => Record<string, unknown>;
};

const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const ORACLE = "ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle";

const HOOKS: Record<string, Hook[]> = {
	mainnet: [
		{
			id: "wh_sbtc",
			name: "sbtc-deposits",
			url: "https://api.example.dev/hooks/sbtc",
			triggers: [{ type: "sbtc_deposit" }],
			perDay: 180,
			event: (i) => ({
				type: "sbtc_deposit",
				amount: String(2_500_000 + i * 137_000),
				recipient: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
				bitcoin_txid: `9f0c${(41_000 + i).toString(16)}e7a1…`,
			}),
		},
		{
			id: "wh_pox",
			name: "pox5-signers",
			url: "https://api.example.dev/hooks/pox",
			triggers: [{ type: "print_event", contractId: POX5 }],
			perDay: 64,
			event: () => ({
				type: "print_event",
				contract_identifier: POX5,
				topic: "stack-stx",
			}),
		},
		{
			id: "wh_mints",
			name: "mint-alerts",
			url: "https://bot.example.dev/mints",
			triggers: [{ type: "nft_mint" }],
			perDay: 40,
			event: (i) => ({
				type: "nft_mint_event",
				asset_identifier:
					"SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173.the-explorer-guild::The-Explorer-Guild",
				value: `u${3100 + i}`,
				recipient: "SP1HTBVD3JG9C05J7HBJTHGR0GGW7KXW28M5JS8QE",
			}),
		},
	],
	testnet: [
		{
			id: "wh_oracle",
			name: "testnet-oracle",
			url: "https://api.example.dev/hooks/oracle",
			triggers: [{ type: "contract_call", contractId: ORACLE }],
			perDay: 96,
			event: () => ({
				type: "contract_call",
				contract_identifier: ORACLE,
				function_name: "set-value",
			}),
		},
	],
};

/** Deterministic day-to-day wobble so the sparklines have a shape. */
const wobble = (seed: number) =>
	0.75 + ((Math.sin(seed * 12.9898) + 1) / 2) * 0.5;

const iso = (t: number) => new Date(t).toISOString();

function summary(h: Hook, now: number) {
	return {
		id: h.id,
		name: h.name,
		status: "active",
		kind: "chain",
		format: "standard-webhooks",
		url: h.url,
		lastDeliveryAt: iso(now - 2 * MIN),
		lastSuccessAt: iso(now - 2 * MIN),
		circuitOpenedAt: null,
		circuitFailures: 0,
		managedBy: null,
		createdAt: iso(now - 40 * DAY),
		updatedAt: iso(now - 3 * DAY),
	};
}

function detail(h: Hook, now: number) {
	return {
		...summary(h, now),
		triggers: h.triggers,
		auth: { type: "none", headerNames: [], hasSecret: false },
		maxRetries: 7,
		timeoutMs: 10_000,
		concurrency: 4,
		lastError: null,
		receiverCertExpiresAt: null,
		warning: null,
	};
}

function activity(h: Hook, now: number): WebhookActivity {
	const today = Math.floor(now / DAY) * DAY;
	const days = Array.from({ length: 30 }, (_, i) => ({
		day: iso(today - (29 - i) * DAY).slice(0, 10),
		delivered: Math.round(h.perDay * wobble(i + h.id.length)),
		failed: 0,
	}));
	return {
		hours: [],
		waiting: 0,
		nextAttemptAt: null,
		lastSuccessAt: summary(h, now).lastSuccessAt,
		byEventType: {},
		usualByHourOfDay: null,
		days,
	};
}

function deliveries(h: Hook, now: number): DeliveryRow[] {
	const gap = DAY / h.perDay;
	return Array.from({ length: 6 }, (_, i) => {
		const at = now - (i + 1) * gap - (h.id.length % 3) * MIN;
		return {
			id: `${h.id}_d${i}`,
			attempt: 1,
			statusCode: 200,
			errorMessage: null,
			durationMs: 90 + i * 7,
			responseBody: '{"ok":true}',
			dispatchedAt: iso(at),
			blockHeight: 7_312_480 - i * 3,
			blockTime: iso(at - 10_000),
			txId: `0x${(0x9a3f00 + i).toString(16)}b1c4…`,
			eventIndex: i,
		};
	});
}

function deliveryDetail(h: Hook, row: DeliveryRow, i: number) {
	return {
		...row,
		responseHeaders: null,
		outboxId: null,
		payload: {
			type: `chain.${h.triggers[0]?.type}.apply`,
			timestamp: row.dispatchedAt,
			data: {
				action: "apply",
				trigger: h.triggers[0]?.type,
				tx_id: row.txId,
				block_height: row.blockHeight,
				block_time: row.blockTime,
				canonical: true,
				event: h.event(i),
			},
		},
	};
}

const BASES: Record<string, string> = {
	mainnet: "https://api.secondlayer.tools",
	testnet: "https://api.secondlayer.tools/testnet",
};

/** Bodies by proxy path (`/api/sl/<network>/api/webhooks…`), or null. */
export function demoBody(path: string, now = Date.now()): unknown {
	if (path === "/api/sl/health") {
		return Object.fromEntries(
			Object.entries(BASES).map(([n, base]) => [n, { ok: true, base }]),
		);
	}
	const m = path.match(
		/^\/api\/sl\/(\w+)\/api\/webhooks(?:\/([^/?]+))?(\/[^?]*)?/,
	);
	if (!m) return null;
	const [, network, id, rest = ""] = m;
	const hooks = HOOKS[network ?? ""];
	if (!hooks) return null;
	if (!id) return { data: hooks.map((h) => summary(h, now)) };
	const h = hooks.find((x) => x.id === id);
	if (!h) return null;
	if (rest === "") return detail(h, now);
	if (rest === "/activity") return activity(h, now);
	if (rest === "/dead") return { data: [] };
	if (rest === "/deliveries") return { data: deliveries(h, now) };
	const d = rest.match(/^\/deliveries\/(.+)$/);
	if (d) {
		const rows = deliveries(h, now);
		const i = rows.findIndex((r) => r.id === decodeURIComponent(d[1] ?? ""));
		const row = rows[i];
		return row ? deliveryDetail(h, row, i) : null;
	}
	return null;
}

/** A `fetch` for the kit that answers from the example account. */
export function demoFetch(input: string): Promise<Response> {
	const body = demoBody(input);
	return Promise.resolve(
		body === null
			? new Response(JSON.stringify({ error: "Not found" }), { status: 404 })
			: Response.json(body),
	);
}
