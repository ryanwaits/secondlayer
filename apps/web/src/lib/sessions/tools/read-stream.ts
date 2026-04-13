import { apiRequest } from "@/lib/api";
import { highlight } from "@/lib/highlight";
import type { Stream } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";

interface StreamDetail {
	id: string;
	name: string;
	status: string;
	endpointUrl: string;
	filters: unknown[];
	options: Record<string, unknown>;
	totalDeliveries?: number;
	failedDeliveries?: number;
	lastTriggeredAt?: string | null;
	lastTriggeredBlock?: number | null;
	errorMessage?: string | null;
	createdAt?: string;
	updatedAt?: string;
}

/**
 * Fetch a deployed stream's full config. Streams use UUID primary keys, but
 * the agent usually only has the human-readable name — so we list first,
 * resolve the name to an id, then GET `/api/streams/:id`. The returned
 * config JSON is pretty-printed + highlighted so the chat card can render
 * a clean read-only view.
 */
export function createReadStream(sessionToken: string) {
	return tool({
		description:
			"Fetch a deployed stream's current config (name, endpoint, filters, options, metrics). ALWAYS call this before edit_stream so the user sees the exact filter array you're about to modify. Accepts either a stream name or a UUID — resolves the name via list lookup. Returns a read-only config payload plus pretty-printed JSON for the display card.",
		inputSchema: z.object({
			nameOrId: z.string().describe("Stream name or UUID"),
		}),
		execute: async ({ nameOrId }) => {
			try {
				let streamId = nameOrId;
				const looksLikeUuid =
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
						nameOrId,
					);
				if (!looksLikeUuid) {
					const list = await apiRequest<{ streams: Stream[] }>(
						"/api/streams?limit=100&offset=0",
						{ sessionToken },
					);
					const match = (list.streams ?? []).find((s) => s.name === nameOrId);
					if (!match) {
						return {
							error: true,
							message: `No stream found with name "${nameOrId}"`,
						};
					}
					streamId = match.id;
				}

				const detail = await apiRequest<StreamDetail>(
					`/api/streams/${streamId}`,
					{ sessionToken },
				);

				const configJson = JSON.stringify(
					{
						name: detail.name,
						endpointUrl: detail.endpointUrl,
						filters: detail.filters,
						options: detail.options,
					},
					null,
					2,
				);
				const html = await highlight(configJson, "json");

				return {
					id: detail.id,
					name: detail.name,
					status: detail.status,
					endpointUrl: detail.endpointUrl,
					filters: detail.filters,
					options: detail.options,
					configJson,
					html,
					totalDeliveries: detail.totalDeliveries ?? 0,
					failedDeliveries: detail.failedDeliveries ?? 0,
					lastTriggeredAt: detail.lastTriggeredAt ?? null,
				};
			} catch (err) {
				return {
					error: true,
					message: err instanceof Error ? err.message : String(err),
				};
			}
		},
	});
}
