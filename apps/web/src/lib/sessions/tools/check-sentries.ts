import { apiRequest } from "@/lib/api";
import { tool } from "ai";
import { z } from "zod";

interface SentrySummary {
	id: string;
	kind: string;
	name: string;
	config: Record<string, unknown>;
	active: boolean;
	last_check_at: string | null;
	delivery_webhook: string;
	created_at: string;
}

export function createCheckSentries(sessionToken: string) {
	return tool({
		description:
			"List the account's configured sentries. Returns id, kind, name, principal/config, active state, last-check time. Use this before proposing create/update/delete so you don't duplicate.",
		inputSchema: z.object({
			kind: z
				.string()
				.optional()
				.describe("Optional: filter to a specific kind (e.g. 'large-outflow')"),
		}),
		execute: async ({ kind }) => {
			const data = await apiRequest<{ data: SentrySummary[] }>(
				"/api/sentries",
				{ sessionToken },
			).catch(() => ({ data: [] as SentrySummary[] }));
			const filtered = kind
				? data.data.filter((s) => s.kind === kind)
				: data.data;
			return {
				sentries: filtered.map((s) => ({
					id: s.id,
					kind: s.kind,
					name: s.name,
					active: s.active,
					principal: String(s.config.principal ?? ""),
					config: s.config,
					lastCheckAt: s.last_check_at,
					webhookHost: safeHost(s.delivery_webhook),
				})),
			};
		},
	});
}

function safeHost(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "(invalid)";
	}
}
