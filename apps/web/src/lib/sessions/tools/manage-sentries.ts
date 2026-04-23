import { tool } from "ai";
import { z } from "zod";

/**
 * Human-in-the-loop tool for sentry management.
 * Supports create, update, delete, test actions.
 * No execute — client renders a confirmation card and dispatches to
 * the platform API on confirm.
 *
 * Always use `list_sentry_kinds` (for create) + `check_sentries`
 * (for update/delete/test) first so the right fields are filled in
 * and you don't duplicate an existing sentry name.
 */
export const manageSentries = tool({
	description:
		"Propose a sentry action — create, update, delete, or test. Requires user confirmation via an action card. Each target carries the fields needed for the action: create needs {kind, name, config, deliveryWebhook}; update needs {id, name, config?, deliveryWebhook?, active?}; delete/test need {id, name}.",
	inputSchema: z.object({
		action: z.enum(["create", "update", "delete", "test"]),
		targets: z
			.array(
				z.object({
					id: z
						.string()
						.optional()
						.describe("Sentry id (required for update/delete/test)"),
					name: z
						.string()
						.describe(
							"Display name — for create this is the new sentry name; for others it's the existing sentry's name, shown on the confirm card.",
						),
					kind: z
						.enum([
							"large-outflow",
							"permission-change",
							"ft-outflow",
							"contract-deployment",
							"print-event-match",
						])
						.optional()
						.describe("Required for create"),
					config: z
						.record(z.string(), z.unknown())
						.optional()
						.describe(
							"Per-kind config. Required for create; optional for update. See list_sentry_kinds for the shape per kind.",
						),
					deliveryWebhook: z
						.string()
						.url()
						.optional()
						.describe("Slack-compatible https webhook. Required for create."),
					active: z
						.boolean()
						.optional()
						.describe("Update-only: enable/disable the sentry."),
					reason: z
						.string()
						.optional()
						.describe(
							"Brief human-readable reason, shown on the confirm card.",
						),
				}),
			)
			.min(1)
			.max(10)
			.describe("List of sentries to act on (usually just one)."),
	}),
});
