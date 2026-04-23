import type {
	CreateSentryRequest,
	SentryKind,
	UpdateSentryRequest,
} from "@secondlayer/shared/schemas/sentries";
import { BaseClient } from "../base.ts";

export interface SentrySummary {
	id: string;
	account_id: string;
	kind: SentryKind;
	name: string;
	config: Record<string, unknown>;
	active: boolean;
	last_check_at: string | null;
	delivery_webhook: string;
	created_at: string;
	updated_at: string;
}

export interface SentryAlert {
	id: string;
	fired_at: string;
	delivery_status: string;
	delivery_error: string | null;
	payload: Record<string, unknown>;
}

export interface SentryDetail {
	sentry: SentrySummary;
	alerts: SentryAlert[];
}

export interface SentryKindInfo {
	kind: SentryKind;
	displayName: string;
	description: string;
	/** Example config the caller can fill in. */
	configExample: Record<string, unknown>;
}

const KIND_INFO: Record<SentryKind, SentryKindInfo> = {
	"large-outflow": {
		kind: "large-outflow",
		displayName: "Large outflow",
		description:
			"Watch a principal for STX transfers above a threshold (treasury watch, whale alerts).",
		configExample: {
			principal: "SP...",
			thresholdMicroStx: "100000000000",
		},
	},
	"permission-change": {
		kind: "permission-change",
		displayName: "Permission change",
		description:
			"Alert on successful calls to admin functions on a watched contract (role rotation, ownership transfer, takeover).",
		configExample: {
			principal: "SP....contract-name",
			adminFunctions: ["set-owner", "set-admin", "transfer-ownership"],
		},
	},
	"ft-outflow": {
		kind: "ft-outflow",
		displayName: "FT outflow",
		description:
			"Watch a principal for SIP-010 token transfers above a threshold (token drain detection).",
		configExample: {
			principal: "SP...",
			assetIdentifier: "SP....token-name::token-symbol",
			thresholdAmount: "1000000",
		},
	},
	"contract-deployment": {
		kind: "contract-deployment",
		displayName: "Contract deployment",
		description:
			"Alert when a watched principal deploys a new smart contract (supply-chain / vault-drain vector).",
		configExample: {
			principal: "SP...",
		},
	},
	"print-event-match": {
		kind: "print-event-match",
		displayName: "Print event match",
		description:
			"Alert on specific (contract, topic) print events — custom DeFi alerts for liquidations, pool drains, governance proposals.",
		configExample: {
			principal: "SP....contract-name",
			topic: "liquidation",
		},
	},
};

export class Sentries extends BaseClient {
	async list(): Promise<{ data: SentrySummary[] }> {
		return this.request<{ data: SentrySummary[] }>("GET", "/api/sentries");
	}

	async get(id: string): Promise<SentryDetail> {
		return this.request<SentryDetail>("GET", `/api/sentries/${id}`);
	}

	async create(
		payload: CreateSentryRequest,
	): Promise<{ sentry: SentrySummary }> {
		return this.request<{ sentry: SentrySummary }>(
			"POST",
			"/api/sentries",
			payload,
		);
	}

	async update(
		id: string,
		payload: UpdateSentryRequest,
	): Promise<{ sentry: SentrySummary }> {
		return this.request<{ sentry: SentrySummary }>(
			"PATCH",
			`/api/sentries/${id}`,
			payload,
		);
	}

	async delete(id: string): Promise<{ ok: true }> {
		return this.request<{ ok: true }>("DELETE", `/api/sentries/${id}`);
	}

	async test(
		id: string,
	): Promise<{ ok: boolean; runId?: string; error?: string }> {
		return this.request<{ ok: boolean; runId?: string; error?: string }>(
			"POST",
			`/api/sentries/${id}/test`,
		);
	}

	/**
	 * Enumerate the available sentry kinds with their config shape. Used
	 * by agent-facing tools (MCP, chat) to guide users through picking a
	 * kind + filling out the right fields.
	 */
	listKinds(): SentryKindInfo[] {
		return Object.values(KIND_INFO);
	}
}
