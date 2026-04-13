import { apiRequest } from "@/lib/api";
import type { Stream } from "@/lib/types";
import { tool } from "ai";
import { z } from "zod";

/**
 * Tail a stream's recent deliveries. Returns `{ id, name }`; the renderer
 * opens a DeliveriesTailCard that polls /api/streams/:id/deliveries every 3s.
 * Name-to-id resolution happens here so the card only has to poll.
 */
export function createTailDeliveries(sessionToken: string) {
	return tool({
		description:
			"Tail a stream's recent webhook deliveries live. Pass the stream name or UUID. The UI polls /api/streams/:id/deliveries every 3s and renders a timeline of delivery attempts (block height, status code, response time). Use this when the user asks to 'watch deliveries', 'tail', or 'follow' a stream after deploying.",
		inputSchema: z.object({
			nameOrId: z.string().describe("Stream name or UUID"),
		}),
		execute: async ({ nameOrId }) => {
			try {
				const looksLikeUuid =
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
						nameOrId,
					);
				if (looksLikeUuid) {
					return { id: nameOrId, name: nameOrId };
				}
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
				return { id: match.id, name: match.name };
			} catch (err) {
				return {
					error: true,
					message: err instanceof Error ? err.message : String(err),
				};
			}
		},
	});
}
