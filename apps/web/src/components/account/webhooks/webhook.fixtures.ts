import type {
	DeliveryRow,
	WebhookActivity,
	WebhookDetail,
	WebhookSummary,
} from "@secondlayer/sdk";

export const FIXTURE_NOW = Date.parse("2026-10-15T12:30:00Z");
const HOUR = 3_600_000;

export const FIXTURE_HOURS: string[] = Array.from({ length: 168 }, (_, i) =>
	new Date(
		Math.floor(FIXTURE_NOW / HOUR) * HOUR - (167 - i) * HOUR,
	).toISOString(),
);

export function summary(over: Partial<WebhookSummary> = {}): WebhookSummary {
	return {
		id: "wh_deposits",
		name: "sbtc-deposits",
		status: "active",
		kind: "chain",
		format: "standard-webhooks",
		url: "https://hooks.example.dev/stacks",
		lastDeliveryAt: "2026-10-15T12:10:00.000Z",
		lastSuccessAt: "2026-10-15T12:10:00.000Z",
		circuitOpenedAt: null,
		circuitFailures: 0,
		managedBy: null,
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-15T12:10:00.000Z",
		...over,
	};
}

export function detail(over: Partial<WebhookDetail> = {}): WebhookDetail {
	return {
		...summary(),
		triggers: [{ type: "stx_transfer" }],
		auth: { type: "none", headerNames: [], hasSecret: false },
		maxRetries: 7,
		timeoutMs: 10_000,
		concurrency: 4,
		lastError: null,
		receiverCertExpiresAt: null,
		warning: null,
		...over,
	};
}

export function attempt(over: Partial<DeliveryRow> = {}): DeliveryRow {
	return {
		id: "d_1",
		attempt: 1,
		statusCode: 200,
		errorMessage: null,
		durationMs: 120,
		responseBody: null,
		dispatchedAt: "2026-10-15T12:10:00.000Z",
		blockHeight: 9_000_001,
		blockTime: "2026-10-15T12:09:50.000Z",
		txId: "0x920af4720020f5aba341630e8965851f8537bc8fc99a856091093780c886a2c77",
		eventIndex: 4,
		...over,
	};
}

export function activityFor(
	delivered: number,
	over: Partial<WebhookActivity> = {},
): WebhookActivity {
	return {
		hours: FIXTURE_HOURS.map((hour) => ({
			hour,
			delivered,
			waiting: 0,
			gaveUp: 0,
			failed: 0,
		})),
		waiting: 0,
		nextAttemptAt: null,
		lastSuccessAt: null,
		byEventType: { "chain.stx_transfer.apply": delivered * 168 },
		usualByHourOfDay: null,
		days: [],
		...over,
	};
}
