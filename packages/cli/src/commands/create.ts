import { readFileSync } from "node:fs";
import { SecondLayer } from "@secondlayer/sdk";
import type { CreateWebhookRequest } from "@secondlayer/sdk";
import {
	type ChainTrigger,
	ChainTriggerSchema,
} from "@secondlayer/shared/schemas/webhooks";
import type { Command } from "commander";
import { blue, error, info, success } from "../lib/output.ts";
import { resolveHostedAuth } from "../lib/resolve-auth.ts";

export interface CreateWebhookOptions {
	url?: string;
	authToken?: string;
	trigger?: string[];
	triggersFile?: string;
	format?: string;
}

/**
 * Parse `--trigger <json>` (repeatable) and `--triggers-file <path>` into a
 * validated `ChainTrigger[]`. Inline values are single JSON objects; the file is
 * a JSON array of triggers. Every entry is validated against `ChainTriggerSchema`
 * so a typo'd `type` fails here with a clear message, not server-side later.
 */
export function parseTriggersInput(
	opts: Pick<CreateWebhookOptions, "trigger" | "triggersFile">,
): ChainTrigger[] {
	const raw: unknown[] = [];

	if (opts.triggersFile) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(opts.triggersFile, "utf8"));
		} catch (err) {
			throw new Error(
				`Could not read/parse --triggers-file ${opts.triggersFile}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		if (!Array.isArray(parsed)) {
			throw new Error("--triggers-file must contain a JSON array of triggers");
		}
		raw.push(...parsed);
	}

	for (const value of opts.trigger ?? []) {
		try {
			raw.push(JSON.parse(value));
		} catch {
			throw new Error(`--trigger is not valid JSON: ${value}`);
		}
	}

	if (raw.length === 0) {
		throw new Error("Provide at least one --trigger or --triggers-file");
	}

	return raw.map((entry, i) => {
		const result = ChainTriggerSchema.safeParse(entry);
		if (!result.success) {
			throw new Error(
				`Invalid trigger at index ${i}: ${result.error.issues[0]?.message ?? "validation failed"}`,
			);
		}
		return result.data;
	});
}

export function buildWebhookAuthConfig(
	authToken?: string,
): Record<string, unknown> | undefined {
	if (authToken === undefined) return undefined;
	const token = authToken.trim();
	if (token.length === 0) {
		throw new Error("--auth-token must not be empty");
	}
	return { authType: "bearer", token };
}

/**
 * `secondlayer webhooks create <name> --url <url> --trigger '<json>'`
 *
 * Provisions a webhook (a `triggers` array) over the session-authed SDK.
 */
export async function createChainWebhook(
	name: string,
	opts: CreateWebhookOptions,
): Promise<void> {
	if (!opts.url) {
		error("--url is required");
		process.exit(1);
	}

	let triggers: ChainTrigger[];
	let authConfig: Record<string, unknown> | undefined;
	try {
		triggers = parseTriggersInput(opts);
		authConfig = buildWebhookAuthConfig(opts.authToken);
	} catch (err) {
		error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}

	const sl = await getWebhookClient();
	let webhookId: string;
	let signingSecret: string;
	try {
		const res = await sl.webhooks.create({
			name,
			url: opts.url,
			triggers,
			format: (opts.format ??
				"standard-webhooks") as CreateWebhookRequest["format"],
			...(authConfig ? { authConfig } : {}),
		} as CreateWebhookRequest);
		webhookId = res.webhook.id;
		signingSecret = res.signingSecret;
		success(`Webhook provisioned: ${blue(webhookId)}`);
	} catch (err) {
		error(
			`Webhook provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	}

	info(`Signing secret (store securely): ${signingSecret}`);

	console.log();
	success(
		`Done. Next:\n  View deliveries:\n  secondlayer webhooks get ${name}`,
	);
}

export async function getWebhookClient(): Promise<SecondLayer> {
	// Hosted-aware (plan 044): account key on the merchant host, instance
	// token/session everywhere else — same as `resolveDataPlaneKey` for
	// Index/Streams, so webhooks works against api.secondlayer.tools with a
	// `sk-sl_*` key without touching self-host's session/instance-token path.
	const { apiUrl, ephemeralKey } = await resolveHostedAuth();
	return new SecondLayer({ baseUrl: apiUrl, apiKey: ephemeralKey });
}

/** `secondlayer webhooks create <name>`. */
export function addWebhooksCreateCommand(parent: Command): void {
	parent
		.command("create <name>")
		.description("Create a webhook on raw chain events")
		.option("-u, --url <url>", "Webhook URL")
		.option(
			"--auth-token <token>",
			"Bearer token for receiver API auth; a flag lands in shell history and ps, so set it in the receiver's env and pass it here only for a throwaway token",
		)
		.option(
			"--trigger <json...>",
			'Chain trigger as JSON (repeatable), e.g. \'{"type":"sbtc_deposit"}\'',
		)
		.option("--triggers-file <path>", "Chain triggers as a JSON array file")
		.option("--format <format>", "Delivery format (default standard-webhooks)")
		.addHelpText(
			"after",
			`
Examples:
  $ secondlayer webhooks create my-hook -u https://example.com/webhook --trigger '{"type":"sbtc_deposit"}'
  $ secondlayer webhooks create my-hook -u https://example.com/webhook --triggers-file triggers.json`,
		)
		.action(createChainWebhook);
}
