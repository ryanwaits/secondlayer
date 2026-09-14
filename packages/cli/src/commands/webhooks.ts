import type { SecondLayer } from "@secondlayer/sdk";
import { sign } from "@secondlayer/shared/crypto/standard-webhooks";
import type { SubgraphDetail } from "@secondlayer/shared/schemas/subgraphs";
import type {
	DeadRow,
	DeliveryRow,
	UpdateWebhookRequest,
	WebhookDetail,
	WebhookSummary,
} from "@secondlayer/shared/schemas/webhooks";
import type { Command } from "commander";
import { handleApiError } from "../lib/api-client.ts";
import { parseWebhookFilter } from "../lib/filter-params.ts";
import {
	blue,
	confirmDestructive,
	dim,
	formatKeyValue,
	formatTable,
	green,
	info,
	success,
	warn,
	yellow,
} from "../lib/output.ts";
import { assertInstanceUrl } from "../lib/resolve-auth.ts";
import { validateWebhookTargetFromApi } from "../lib/webhook-validation.ts";
import { addWebhooksCreateCommand } from "./create.ts";
import { buildWebhookAuthConfig, getWebhookClient } from "./create.ts";

interface CommonOptions {
	json?: boolean;
	yes?: boolean;
}

interface UpdateOptions extends CommonOptions {
	name?: string;
	url?: string;
	authToken?: string;
	format?: string;
	runtime?: string;
	filter?: string[];
	clearFilter?: boolean;
	maxRetries?: string;
	timeoutMs?: string;
	concurrency?: string;
}

interface TestOptions extends CommonOptions {
	signingSecret?: string;
	post?: boolean;
	local?: boolean;
}

export interface ResolvedWebhook {
	id: string;
	detail: WebhookDetail;
}

type WebhookClientLike = Pick<SecondLayer, "webhooks">;

function parseIntegerOption(
	value: string | undefined,
	name: string,
	min: number,
): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || String(parsed) !== value.trim()) {
		throw new Error(`${name} must be an integer`);
	}
	if (parsed < min) throw new Error(`${name} must be >= ${min}`);
	return parsed;
}

function requireIntegerOption(value: string | undefined, name: string): number {
	const parsed = parseIntegerOption(value, name, 0);
	if (parsed === undefined) throw new Error(`${name} is required`);
	return parsed;
}

function truncate(value: string, max = 48): string {
	return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function formatMaybeDate(value: string | null): string {
	return value ? value.replace("T", " ").slice(0, 19) : dim("-");
}

function isSuccessDelivery(row: DeliveryRow): boolean {
	return (
		row.statusCode !== null && row.statusCode >= 200 && row.statusCode < 300
	);
}

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

export async function resolveWebhookRef(
	client: WebhookClientLike,
	ref: string,
): Promise<ResolvedWebhook> {
	const { data } = await client.webhooks.list();
	const idMatch = data.find((sub: WebhookSummary) => sub.id === ref);
	if (idMatch) {
		return {
			id: idMatch.id,
			detail: await client.webhooks.get(idMatch.id),
		};
	}

	const nameMatches = data.filter((sub: WebhookSummary) => sub.name === ref);
	if (nameMatches.length > 1) {
		throw new Error(`Webhook name "${ref}" is ambiguous; use the webhook id.`);
	}
	if (nameMatches[0]) {
		return {
			id: nameMatches[0].id,
			detail: await client.webhooks.get(nameMatches[0].id),
		};
	}

	// Non-UUID ref not matched by name → it can't be a valid webhook ID.
	const UUID_RE =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (!UUID_RE.test(ref)) {
		throw new Error(`Webhook "${ref}" not found.`);
	}
	return {
		id: ref,
		detail: await client.webhooks.get(ref),
	};
}

export function buildWebhookUpdatePatch(
	options: UpdateOptions,
): UpdateWebhookRequest {
	const patch: UpdateWebhookRequest = {};
	if (options.name) patch.name = options.name;
	if (options.url) patch.url = options.url;
	const authConfig = buildWebhookAuthConfig(options.authToken);
	if (authConfig) patch.authConfig = authConfig;
	if (options.format) {
		patch.format = options.format as UpdateWebhookRequest["format"];
	}
	if (options.runtime !== undefined) {
		patch.runtime =
			options.runtime === "none" || options.runtime === "null"
				? null
				: (options.runtime as NonNullable<UpdateWebhookRequest["runtime"]>);
	}
	if (options.clearFilter) patch.filter = {};
	if (options.filter) {
		if (options.clearFilter) {
			throw new Error("Use either --filter or --clear-filter, not both");
		}
		patch.filter = (parseWebhookFilter(options.filter) ??
			{}) as UpdateWebhookRequest["filter"];
	}
	const maxRetries = parseIntegerOption(options.maxRetries, "--max-retries", 0);
	if (maxRetries !== undefined) patch.maxRetries = maxRetries;
	const timeoutMs = parseIntegerOption(options.timeoutMs, "--timeout-ms", 100);
	if (timeoutMs !== undefined) patch.timeoutMs = timeoutMs;
	const concurrency = parseIntegerOption(
		options.concurrency,
		"--concurrency",
		1,
	);
	if (concurrency !== undefined) patch.concurrency = concurrency;

	if (Object.keys(patch).length === 0) {
		throw new Error("No update fields provided");
	}

	return patch;
}

function printWebhookDetail(sub: WebhookDetail): void {
	console.log(
		formatKeyValue([
			["ID", sub.id],
			["Name", sub.name],
			["Status", sub.status],
			["Target", `${sub.subgraphName}.${sub.tableName}`],
			["Format", sub.format],
			["Runtime", sub.runtime ?? "none"],
			["URL", sub.url],
			["Last Delivery", sub.lastDeliveryAt ?? "none"],
			["Last Success", sub.lastSuccessAt ?? "none"],
			["Circuit Failures", String(sub.circuitFailures)],
			["Circuit Opened", sub.circuitOpenedAt ?? "none"],
			["Last Error", sub.lastError ?? "none"],
			["Max Retries", String(sub.maxRetries)],
			["Backoff", "30s → 2m → 10m → 1h → 6h → 24h → 72h"],
			["Timeout", `${sub.timeoutMs}ms`],
			["Concurrency", String(sub.concurrency)],
			["Created", sub.createdAt],
			["Updated", sub.updatedAt],
		]),
	);
	console.log(dim("\nFilter:"));
	console.log(JSON.stringify(sub.filter, null, 2));
	if (Object.keys(sub.authConfig).length > 0) {
		console.log(dim("\nAuth config:"));
		console.log(JSON.stringify(sub.authConfig, null, 2));
	}
}

export interface DoctorReport {
	webhook: WebhookDetail;
	deliverySummary: {
		total: number;
		successful: number;
		failed: number;
		last: DeliveryRow | null;
	};
	deadCount: number;
	subgraph: {
		name: string;
		status: string;
		syncStatus: string;
		lastProcessedBlock: number;
		chainTip: number;
		gapCount: number;
		integrity: string;
	} | null;
	hints: string[];
}

export function buildDoctorReport(input: {
	webhook: WebhookDetail;
	deliveries: DeliveryRow[];
	dead: DeadRow[];
	subgraph?: SubgraphDetail | null;
}): DoctorReport {
	const successful = input.deliveries.filter(isSuccessDelivery).length;
	const failed = input.deliveries.length - successful;
	const subgraph = input.subgraph
		? {
				name: input.subgraph.name,
				status: input.subgraph.status,
				syncStatus: input.subgraph.sync.status,
				lastProcessedBlock: input.subgraph.sync.lastProcessedBlock,
				chainTip: input.subgraph.sync.chainTip,
				gapCount: input.subgraph.sync.gaps.count,
				integrity: input.subgraph.sync.integrity,
			}
		: null;

	const hints: string[] = [];
	if (input.webhook.status === "paused") {
		hints.push(
			`Resume when the receiver is healthy: secondlayer webhooks resume ${input.webhook.id}`,
		);
	}
	if (input.webhook.lastError) {
		hints.push(
			"Run secondlayer webhooks test to reproduce the receiver request.",
		);
	}
	if (input.webhook.circuitOpenedAt || input.webhook.circuitFailures > 0) {
		hints.push(
			"Circuit breaker has failures; inspect receiver logs and delivery status codes.",
		);
	}
	if (input.dead.length > 0) {
		hints.push(
			`Dead-letter rows exist; inspect with secondlayer webhooks dead ${input.webhook.id} and requeue selected rows.`,
		);
	}
	if (subgraph?.gapCount && subgraph.gapCount > 0) {
		hints.push(
			`Linked subgraph has gaps; run secondlayer subgraphs gaps ${input.webhook.subgraphName}.`,
		);
	}
	if (subgraph?.syncStatus === "catching_up") {
		hints.push(
			"Linked subgraph is still catching up; new matching rows may arrive later.",
		);
	}
	if (input.deliveries.length === 0) {
		hints.push(
			"No deliveries yet; confirm the table is receiving inserted rows that match the filter.",
		);
	}
	if (hints.length === 0) {
		hints.push("No immediate action needed.");
	}

	return {
		webhook: input.webhook,
		deliverySummary: {
			total: input.deliveries.length,
			successful,
			failed,
			last: input.deliveries[0] ?? null,
		},
		deadCount: input.dead.length,
		subgraph,
		hints,
	};
}

function printDoctorReport(report: DoctorReport): void {
	const sub = report.webhook;
	console.log(
		formatKeyValue([
			["Webhook", `${sub.name} (${sub.id})`],
			["Status", sub.status],
			["Target", `${sub.subgraphName}.${sub.tableName}`],
			["Format", sub.format],
			["Runtime", sub.runtime ?? "none"],
			["URL", sub.url],
			[
				"Circuit",
				sub.circuitOpenedAt
					? `open at ${sub.circuitOpenedAt}`
					: `${sub.circuitFailures} failures`,
			],
			["Last Error", sub.lastError ?? "none"],
			["Last Delivery", sub.lastDeliveryAt ?? "none"],
			["Last Success", sub.lastSuccessAt ?? "none"],
		]),
	);

	console.log(dim("\nDelivery summary:"));
	console.log(
		formatKeyValue([
			["Recent Attempts", String(report.deliverySummary.total)],
			["Successful", String(report.deliverySummary.successful)],
			["Failed", String(report.deliverySummary.failed)],
			[
				"Last Attempt",
				report.deliverySummary.last
					? `${report.deliverySummary.last.statusCode ?? "error"} at ${report.deliverySummary.last.dispatchedAt}`
					: "none",
			],
			["Dead Letter Rows", String(report.deadCount)],
		]),
	);

	if (report.subgraph) {
		console.log(dim("\nLinked subgraph:"));
		console.log(
			formatKeyValue([
				["Name", report.subgraph.name],
				["Status", report.subgraph.status],
				["Sync", report.subgraph.syncStatus],
				[
					"Blocks",
					`${report.subgraph.lastProcessedBlock} / ${report.subgraph.chainTip}`,
				],
				["Integrity", report.subgraph.integrity],
				["Gaps", String(report.subgraph.gapCount)],
			]),
		);
	}

	console.log(dim("\nNext steps:"));
	for (const hint of report.hints) console.log(`  - ${hint}`);
}

function syntheticValue(type: string): unknown {
	switch (type) {
		case "uint":
		case "int":
			return "1000";
		case "boolean":
			return true;
		case "timestamp":
			return new Date(0).toISOString();
		case "jsonb":
			return {};
		case "principal":
			return "SP000000000000000000002Q6VF78";
		default:
			return "example";
	}
}

export function buildSyntheticRow(
	subgraph: SubgraphDetail | null,
	tableName: string,
) {
	const table = subgraph?.tables[tableName];
	if (!table) return { id: "example", value: "example" };
	const row: Record<string, unknown> = {};
	for (const [column, def] of Object.entries(table.columns)) {
		if (column.startsWith("_")) continue;
		row[column] = syntheticValue(def.type);
	}
	return Object.keys(row).length > 0
		? row
		: { id: "example", value: "example" };
}

export function resolveSigningSecret(
	options: Pick<TestOptions, "signingSecret">,
	env: Record<string, string | undefined> = process.env,
): string {
	const secret = options.signingSecret ?? env.SIGNING_SECRET;
	if (!secret) {
		throw new Error("Provide --signing-secret or set SIGNING_SECRET.");
	}
	return secret;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildWebhookTestFixture(input: {
	webhook: Pick<
		WebhookDetail,
		"id" | "kind" | "subgraphName" | "tableName" | "triggers" | "url"
	>;
	row: Record<string, unknown>;
	signingSecret: string;
	nowSeconds?: number;
	id?: string;
}): { body: string; headers: Record<string, string>; curl: string } {
	const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
	const sub = input.webhook;
	const isChain = sub.kind === "chain";
	// Chain subs deliver an apply envelope keyed `chain.{type}.apply`; subgraph
	// subs deliver `{subgraph}.{table}.{created|updated|deleted}` (verb per row
	// op) with the row as data — this preview shows a `.created` example.
	const type = isChain
		? `chain.${sub.triggers?.[0]?.type ?? "event"}.apply`
		: `${sub.subgraphName}.${sub.tableName}.created`;
	const data = isChain
		? {
				action: "apply",
				canonical: true,
				block_hash: "0xexampleblock",
				block_height: 0,
				tx_id: input.row.tx_id ?? "0xexampletransaction",
				trigger: sub.triggers?.[0]?.type ?? "event",
				event: input.row,
			}
		: input.row;
	const body = JSON.stringify({
		type,
		timestamp: new Date(nowSeconds * 1000).toISOString(),
		data,
	});
	const headers = {
		"content-type": "application/json",
		...sign(body, input.signingSecret, {
			id: input.id ?? `test-${input.webhook.id}`,
			timestampSeconds: nowSeconds,
		}),
	};
	const headerArgs = Object.entries(headers)
		.map(([key, value]) => `  -H ${shellQuote(`${key}: ${value}`)} \\`)
		.join("\n");
	const curl = [
		`curl -X POST ${shellQuote(input.webhook.url)} \\`,
		headerArgs,
		`  --data ${shellQuote(body)}`,
	].join("\n");

	return { body, headers, curl };
}

async function representativeRow(
	client: SecondLayer,
	sub: WebhookDetail,
	subgraph: SubgraphDetail | null,
): Promise<Record<string, unknown>> {
	// Chain webhooks have no subgraph table to sample — use a synthetic
	// chain event keyed off the first trigger.
	if (sub.kind === "chain" || !sub.subgraphName || !sub.tableName) {
		return {
			tx_id: "0xexampletransaction",
			contract_id: "SP000000000000000000002Q6VF78.example",
			...(sub.triggers?.[0]?.type === "contract_call"
				? { function_name: "example-fn" }
				: {}),
		};
	}
	try {
		const rows = (await client.subgraphs.queryTable(
			sub.subgraphName,
			sub.tableName,
			{
				sort: "_block_height",
				order: "desc",
				limit: 1,
			},
		)) as Record<string, unknown>[];
		if (rows[0] && typeof rows[0] === "object") return rows[0];
	} catch {}
	return buildSyntheticRow(subgraph, sub.tableName);
}

function printDeliveries(rows: DeliveryRow[]): void {
	if (rows.length === 0) {
		console.log(dim("No delivery attempts"));
		return;
	}
	console.log(
		formatTable(
			["Dispatched", "Attempt", "Status", "Duration", "Error"],
			rows.map((row) => [
				formatMaybeDate(row.dispatchedAt),
				String(row.attempt),
				row.statusCode === null
					? redStatus("error")
					: isSuccessDelivery(row)
						? green(String(row.statusCode))
						: yellow(String(row.statusCode)),
				row.durationMs === null ? dim("-") : `${row.durationMs}ms`,
				row.errorMessage ? truncate(row.errorMessage, 64) : dim("-"),
			]),
		),
	);
}

function redStatus(text: string): string {
	return `\x1b[31m${text}\x1b[0m`;
}

function printDead(rows: DeadRow[]): void {
	if (rows.length === 0) {
		console.log(dim("No dead-letter rows"));
		return;
	}
	console.log(
		formatTable(
			["ID", "Event", "Block", "Attempt", "Failed"],
			rows.map((row) => [
				row.id,
				row.eventType,
				String(row.blockHeight),
				String(row.attempt),
				formatMaybeDate(row.failedAt),
			]),
		),
	);
}

async function confirmOrExit(message: string, yes?: boolean): Promise<boolean> {
	const ok = await confirmDestructive({ message, yes });
	if (!ok) info("Cancelled");
	return ok;
}

function attachWebhookSubcommands(parent: Command): void {
	addWebhooksCreateCommand(parent);

	parent
		.command("list")
		.alias("ls")
		.description("List webhooks")
		.option("--json", "Output as JSON")
		.action(async (options: CommonOptions) => {
			try {
				const client = await getWebhookClient();
				const { data } = await client.webhooks.list();
				if (options.json) {
					printJson(data);
					return;
				}
				if (data.length === 0) {
					console.log(dim("No webhooks"));
					return;
				}
				console.log(
					formatTable(
						["Name", "ID", "Status", "Target", "Format", "Last Success"],
						data.map((sub) => [
							sub.name,
							sub.id,
							sub.status === "active"
								? green(sub.status)
								: sub.status === "paused"
									? yellow(sub.status)
									: redStatus(sub.status),
							`${sub.subgraphName}.${sub.tableName}`,
							sub.format,
							formatMaybeDate(sub.lastSuccessAt),
						]),
					),
				);
				console.log(dim(`\n${data.length} webhook(s) total`));
			} catch (err) {
				handleApiError(err, "list webhooks");
			}
		});

	parent
		.command("get <idOrName>")
		.description("Show webhook details")
		.option("--json", "Output as JSON")
		.action(async (idOrName: string, options: CommonOptions) => {
			try {
				const client = await getWebhookClient();
				const { detail } = await resolveWebhookRef(client, idOrName);
				if (options.json) printJson(detail);
				else printWebhookDetail(detail);
			} catch (err) {
				handleApiError(err, "get webhook");
			}
		});

	parent
		.command("update <idOrName>")
		.description("Update webhook config")
		.option("--name <name>", "Rename webhook")
		.option("--url <url>", "Webhook URL")
		.option(
			"--auth-token <token>",
			"Set bearer token auth config; a flag lands in shell history and ps, so pass it here only for a throwaway token",
		)
		.option(
			"--format <format>",
			"standard-webhooks | inngest | trigger | cloudflare | cloudevents | raw",
		)
		.option(
			"--runtime <runtime>",
			"inngest | trigger | cloudflare | node | none",
		)
		.option(
			"--filter <kv...>",
			"Filter as key=value (supports .eq/.neq/.gt/.gte/.lt/.lte suffixes)",
		)
		.option("--clear-filter", "Replace filter with {}")
		.option("--max-retries <n>", "Maximum delivery retries")
		.option("--timeout-ms <n>", "Delivery timeout in milliseconds")
		.option("--concurrency <n>", "Per-webhook delivery concurrency")
		.option("--json", "Output as JSON")
		.addHelpText(
			"after",
			`
Examples:
  $ secondlayer webhooks update my-sub --url https://example.com/hook
  $ secondlayer webhooks update my-sub --filter amount.gte=1000 --max-retries 5
  $ secondlayer webhooks update my-sub --clear-filter`,
		)
		.action(async (idOrName: string, options: UpdateOptions) => {
			try {
				const client = await getWebhookClient();
				const patch = buildWebhookUpdatePatch(options);
				const { id, detail } = await resolveWebhookRef(client, idOrName);
				if (
					patch.filter !== undefined &&
					detail.subgraphName &&
					detail.tableName
				) {
					await validateWebhookTargetFromApi(client, {
						subgraphName: detail.subgraphName,
						tableName: detail.tableName,
						filter: patch.filter,
					});
				}
				const updated = await client.webhooks.update(id, patch);
				if (options.json) printJson(updated);
				else success(`Updated webhook ${blue(updated.name)}`);
			} catch (err) {
				handleApiError(err, "update webhook");
			}
		});

	for (const action of ["pause", "resume"] as const) {
		parent
			.command(`${action} <idOrName>`)
			.description(`${action === "pause" ? "Pause" : "Resume"} a webhook`)
			.option("--json", "Output as JSON")
			.action(async (idOrName: string, options: CommonOptions) => {
				try {
					const client = await getWebhookClient();
					const { id } = await resolveWebhookRef(client, idOrName);
					const updated = await client.webhooks[action](id);
					if (options.json) printJson(updated);
					else
						success(
							`${action === "pause" ? "Paused" : "Resumed"} ${blue(updated.name)}`,
						);
				} catch (err) {
					handleApiError(err, `${action} webhook`);
				}
			});
	}

	parent
		.command("delete <idOrName>")
		.alias("rm")
		.description("Delete a webhook")
		.option("-y, --yes", "Skip confirmation")
		.option("--json", "Output as JSON")
		.action(async (idOrName: string, options: CommonOptions) => {
			try {
				const client = await getWebhookClient();
				let resolved: ResolvedWebhook | null = null;
				try {
					resolved = await resolveWebhookRef(client, idOrName);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					const status = (err as { status?: number } | undefined)?.status;
					if (status === 404 || /not found/i.test(msg)) {
						// Idempotent: second delete is a no-op, not a 500.
						if (options.json)
							printJson({ deleted: false, reason: "not_found" });
						else info(`Webhook "${idOrName}" not found (already deleted?)`);
						return;
					}
					throw err;
				}
				const { id, detail } = resolved;
				const ok = await confirmOrExit(
					`Delete webhook "${detail.name}"? Pending outbox rows will be removed.`,
					options.yes,
				);
				if (!ok) return;
				const res = await client.webhooks.delete(id);
				if (options.json) printJson(res);
				else success(`Deleted webhook ${blue(detail.name)}`);
			} catch (err) {
				handleApiError(err, "delete webhook");
			}
		});

	parent
		.command("rotate-secret <idOrName>")
		.description("Rotate the signing secret")
		.option("-y, --yes", "Skip confirmation")
		.option("--json", "Output as JSON")
		.action(async (idOrName: string, options: CommonOptions) => {
			try {
				const client = await getWebhookClient();
				const { id, detail } = await resolveWebhookRef(client, idOrName);
				const ok = await confirmOrExit(
					`Rotate signing secret for "${detail.name}"? Existing receivers using the old secret will fail verification.`,
					options.yes,
				);
				if (!ok) return;
				const res = await client.webhooks.rotateSecret(id);
				if (options.json) printJson(res);
				else {
					success(`Rotated signing secret for ${blue(res.webhook.name)}`);
					console.log(res.signingSecret);
				}
			} catch (err) {
				handleApiError(err, "rotate webhook secret");
			}
		});

	parent
		.command("deliveries <idOrName>")
		.description("Show recent delivery attempts")
		.option("--json", "Output as JSON")
		.action(async (idOrName: string, options: CommonOptions) => {
			try {
				const client = await getWebhookClient();
				const { id } = await resolveWebhookRef(client, idOrName);
				const { data } = await client.webhooks.deliveries(id);
				if (options.json) printJson(data);
				else printDeliveries(data);
			} catch (err) {
				handleApiError(err, "list webhook deliveries");
			}
		});

	parent
		.command("dead <idOrName>")
		.description("Show dead-letter outbox rows")
		.option("--json", "Output as JSON")
		.action(async (idOrName: string, options: CommonOptions) => {
			try {
				const client = await getWebhookClient();
				const { id } = await resolveWebhookRef(client, idOrName);
				const { data } = await client.webhooks.dead(id);
				if (options.json) printJson(data);
				else printDead(data);
			} catch (err) {
				handleApiError(err, "list dead-letter rows");
			}
		});

	parent
		.command("requeue <idOrName> <outboxId>")
		.description("Requeue one dead-letter row")
		.option("-y, --yes", "Skip confirmation")
		.option("--json", "Output as JSON")
		.action(
			async (idOrName: string, outboxId: string, options: CommonOptions) => {
				try {
					const client = await getWebhookClient();
					const { id, detail } = await resolveWebhookRef(client, idOrName);
					const ok = await confirmOrExit(
						`Requeue ${outboxId} for "${detail.name}"?`,
						options.yes,
					);
					if (!ok) return;
					const res = await client.webhooks.requeue(id, outboxId);
					if (options.json) printJson(res);
					else success(`Requeued ${blue(outboxId)}`);
				} catch (err) {
					handleApiError(err, "requeue dead-letter row");
				}
			},
		);

	parent
		.command("replay <idOrName>")
		.description("Replay a block range")
		.requiredOption("--from-block <n>", "Start block height")
		.requiredOption("--to-block <n>", "End block height")
		.option("-y, --yes", "Skip confirmation")
		.option("--json", "Output as JSON")
		.addHelpText(
			"after",
			`
Examples:
  $ secondlayer webhooks replay my-sub --from-block 150000 --to-block 160000 -y`,
		)
		.action(
			async (
				idOrName: string,
				options: CommonOptions & { fromBlock?: string; toBlock?: string },
			) => {
				try {
					const fromBlock = requireIntegerOption(
						options.fromBlock,
						"--from-block",
					);
					const toBlock = requireIntegerOption(options.toBlock, "--to-block");
					if (fromBlock > toBlock) {
						throw new Error("--from-block must be <= --to-block");
					}
					const client = await getWebhookClient();
					const { id, detail } = await resolveWebhookRef(client, idOrName);
					// Settlement (`swept_confirmed`) fires on Bitcoin confirmations, not
					// Stacks blocks — it's cursor/confirmed_at driven and forward-only, so
					// a block-range replay never re-emits it. Warn instead of silently
					// dropping those triggers.
					if (
						detail.triggers?.some(
							(t) => t.type === "sbtc_withdrawal_swept_confirmed",
						)
					) {
						warn(
							"sbtc_withdrawal_swept_confirmed triggers are forward-only and not replayed; only on-Stacks sBTC and chain triggers emit over this range.",
						);
					}
					const ok = await confirmOrExit(
						`Replay ${detail.name} from block ${fromBlock} to ${toBlock}?`,
						options.yes,
					);
					if (!ok) return;
					const res = await client.webhooks.replay(id, {
						fromBlock,
						toBlock,
					});
					if (options.json) printJson(res);
					else {
						success(`Replay enqueued: ${blue(res.replayId)}`);
						info(
							`${res.enqueuedCount} row(s) enqueued from ${res.scannedCount} scanned`,
						);
					}
				} catch (err) {
					handleApiError(err, "replay webhook");
				}
			},
		);

	parent
		.command("doctor <idOrName>")
		.description("Diagnose webhook health and next steps")
		.option("--json", "Output as JSON")
		.action(async (idOrName: string, options: CommonOptions) => {
			try {
				const client = await getWebhookClient();
				const { id, detail } = await resolveWebhookRef(client, idOrName);
				const [deliveries, dead, subgraph] = await Promise.allSettled([
					client.webhooks.deliveries(id),
					client.webhooks.dead(id),
					detail.subgraphName
						? client.subgraphs.status(detail.subgraphName)
						: Promise.resolve(null),
				]);
				const report = buildDoctorReport({
					webhook: detail,
					deliveries:
						deliveries.status === "fulfilled" ? deliveries.value.data : [],
					dead: dead.status === "fulfilled" ? dead.value.data : [],
					subgraph: subgraph.status === "fulfilled" ? subgraph.value : null,
				});
				if (options.json) printJson(report);
				else printDoctorReport(report);
			} catch (err) {
				handleApiError(err, "diagnose webhook");
			}
		});

	parent
		.command("test <idOrName>")
		.description(
			"Inspect a webhook fixture; --post sends a logged test delivery via the server (--local POSTs client-side instead)",
		)
		.option(
			"--signing-secret <secret>",
			"Signing secret override (--local only); prefer SIGNING_SECRET in env, a flag lands in shell history and ps",
		)
		.option(
			"--post",
			"Send a test delivery via the server (logged, all formats)",
		)
		.option("--local", "With --post: POST the fixture client-side (not logged)")
		.option("--json", "Output as JSON")
		.action(async (idOrName: string, options: TestOptions) => {
			try {
				const signingSecret = resolveSigningSecret(options);
				const client = await getWebhookClient();
				const { detail } = await resolveWebhookRef(client, idOrName);
				const subgraph = detail.subgraphName
					? await client.subgraphs.status(detail.subgraphName).catch(() => null)
					: null;
				const row = await representativeRow(client, detail, subgraph);
				const fixture = buildWebhookTestFixture({
					webhook: detail,
					row,
					signingSecret,
				});

				// --post (default): server builds for the real format, SSRF-guards,
				// and LOGS the delivery. --local: legacy client-side POST (no log,
				// standard-webhooks fixture only).
				if (options.post && !options.local) {
					const result = await client.webhooks.test(detail.id);
					if (options.json) {
						printJson(result);
						return;
					}
					console.log(dim("Server test delivery:"));
					console.log(JSON.stringify(result, null, 2));
					return;
				}

				let postResult: { status: number; body: string } | null = null;
				if (options.post && options.local) {
					// A receiver that never answers would otherwise hold this command
					// open forever; 15s is longer than any healthy webhook takes.
					const res = await fetch(detail.url, {
						method: "POST",
						headers: fixture.headers,
						body: fixture.body,
						signal: AbortSignal.timeout(15_000),
					});
					postResult = {
						status: res.status,
						body: (await res.text()).slice(0, 2000),
					};
				}
				if (options.json) {
					printJson({ ...fixture, postResult });
					return;
				}
				console.log(dim("Body:"));
				console.log(fixture.body);
				console.log(dim("\nHeaders:"));
				console.log(JSON.stringify(fixture.headers, null, 2));
				console.log(dim("\nCurl:"));
				console.log(fixture.curl);
				if (postResult) {
					console.log(dim("\nPOST result (client-side, not logged):"));
					console.log(`Status: ${postResult.status}`);
					if (postResult.body) console.log(postResult.body);
				}
			} catch (err) {
				handleApiError(err, "test webhook");
			}
		});
}

export function registerWebhooksCommand(program: Command): void {
	const webhooks = program
		.command("webhooks")
		.alias("hooks")
		.description("Manage webhooks: a signed POST to a URL you run");
	webhooks.hook("preAction", () => assertInstanceUrl());
	attachWebhookSubcommands(webhooks);
}
