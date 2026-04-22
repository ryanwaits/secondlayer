import type { Database } from "@secondlayer/shared/db";
import {
	getSentryByIdUnscoped,
	insertAlert,
	touchLastCheck,
	updateAlertDelivery,
} from "@secondlayer/shared/db/queries/sentries";
import type { Kysely } from "kysely";
import { postToWebhook } from "./delivery.ts";
import { getKind } from "./registry.ts";
import type { DetectContext, TriageContext } from "./types.ts";

export interface RunSentryResult {
	sentryId: string;
	matches: number;
	delivered: number;
	deduped: number;
	errors: string[];
}

const INITIAL_LOOKBACK_MS = 60 * 60 * 1000;

export interface RunSentryOptions {
	logger: DetectContext["logger"];
}

export async function runSentryOnce(
	platformDb: Kysely<Database>,
	sourceDb: Kysely<Database>,
	sentryId: string,
	opts: RunSentryOptions,
): Promise<RunSentryResult> {
	const result: RunSentryResult = {
		sentryId,
		matches: 0,
		delivered: 0,
		deduped: 0,
		errors: [],
	};

	const sentry = await getSentryByIdUnscoped(platformDb, sentryId);
	if (!sentry || !sentry.active) return result;

	const kind = getKind(sentry.kind);
	const configParse = kind.configSchema.safeParse(sentry.config);
	if (!configParse.success) {
		const err = `invalid config: ${JSON.stringify(configParse.error.issues)}`;
		opts.logger.error("sentry.config.invalid", { sentryId, error: err });
		result.errors.push(err);
		return result;
	}
	const config = configParse.data;

	const detectCtx: DetectContext = { sourceDb, logger: opts.logger };
	const triageCtx: TriageContext = {
		...detectCtx,
		// `ai` field is only referenced by kinds that pass an explicit model.
		// Our current kind (large-outflow) imports anthropic() directly.
		ai: {} as TriageContext["ai"],
	};

	const since =
		sentry.last_check_at ?? new Date(Date.now() - INITIAL_LOOKBACK_MS);

	const tickStart = new Date();
	let matches: unknown[];
	try {
		matches = await kind.detect(detectCtx, config, since);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		opts.logger.error("sentry.detect.failed", { sentryId, error: msg });
		result.errors.push(`detect: ${msg}`);
		await touchLastCheck(platformDb, sentryId, tickStart);
		return result;
	}

	result.matches = matches.length;

	for (const match of matches) {
		try {
			const triage = await kind.triage(triageCtx, config, match);
			const key = kind.idempotencyKey(match);
			const alertRow = await insertAlert(platformDb, {
				sentry_id: sentryId,
				idempotency_key: key,
				payload: { match, triage } as Record<string, unknown>,
			});
			if (!alertRow) {
				result.deduped += 1;
				continue;
			}
			const message = kind.formatAlert(config, match, triage);
			const delivery = await postToWebhook(sentry.delivery_webhook, message);
			await updateAlertDelivery(
				platformDb,
				alertRow.id,
				delivery.ok ? "delivered" : "failed",
				delivery.error,
			);
			if (delivery.ok) result.delivered += 1;
			else result.errors.push(`delivery: ${delivery.error ?? "unknown"}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			opts.logger.error("sentry.match.failed", { sentryId, error: msg });
			result.errors.push(`match: ${msg}`);
		}
	}

	await touchLastCheck(platformDb, sentryId, tickStart);
	return result;
}

/**
 * Build a synthetic match + run triage + deliver. Does NOT insert into
 * sentry_alerts. Used by the "Send test alert" button.
 */
export async function runTestAlert(
	sourceDb: Kysely<Database>,
	sentry: {
		id: string;
		kind: string;
		config: unknown;
		delivery_webhook: string;
	},
	opts: RunSentryOptions,
): Promise<{ ok: boolean; error?: string }> {
	const kind = getKind(sentry.kind);
	const configParse = kind.configSchema.safeParse(sentry.config);
	if (!configParse.success) {
		return {
			ok: false,
			error: `invalid config: ${JSON.stringify(configParse.error.issues)}`,
		};
	}
	const config = configParse.data;
	const match = kind.buildTestMatch(config);

	const detectCtx: DetectContext = { sourceDb, logger: opts.logger };
	const triageCtx: TriageContext = {
		...detectCtx,
		ai: {} as TriageContext["ai"],
	};

	try {
		const triage = await kind.triage(triageCtx, config, match);
		const message = kind.formatAlert(config, match, triage);
		// Prefix text to mark as test.
		message.text = `[TEST] ${message.text}`;
		if (message.blocks?.[0] && "text" in message.blocks[0]) {
			const header = message.blocks[0] as {
				text: { type: string; text: string };
			};
			header.text.text = `[TEST] ${header.text.text}`;
		}
		const delivery = await postToWebhook(sentry.delivery_webhook, message);
		return delivery.ok ? { ok: true } : { ok: false, error: delivery.error };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: msg };
	}
}
