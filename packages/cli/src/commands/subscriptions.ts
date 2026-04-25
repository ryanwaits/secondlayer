import { confirm } from "@inquirer/prompts";
import type { SecondLayer } from "@secondlayer/sdk";
import { sign } from "@secondlayer/shared/crypto/standard-webhooks";
import type { SubgraphDetail } from "@secondlayer/shared/schemas/subgraphs";
import type {
	DeadRow,
	DeliveryRow,
	SubscriptionDetail,
	SubscriptionSummary,
	UpdateSubscriptionRequest,
} from "@secondlayer/shared/schemas/subscriptions";
import type { Command } from "commander";
import { handleApiError } from "../lib/api-client.ts";
import { parseSubscriptionFilter } from "../lib/filter-params.ts";
import {
	blue,
	dim,
	formatKeyValue,
	formatTable,
	green,
	info,
	success,
	yellow,
} from "../lib/output.ts";
import { validateSubscriptionTargetFromApi } from "../lib/subscription-validation.ts";
import {
	buildSubscriptionAuthConfig,
	getSubscriptionClient,
} from "./create.ts";

interface CommonOptions {
	baseUrl?: string;
	serviceKey?: string;
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
}

export interface ResolvedSubscription {
	id: string;
	detail: SubscriptionDetail;
}

type SubscriptionClientLike = Pick<SecondLayer, "subscriptions">;

function commonOptions<T extends Command>(cmd: T): T {
	return cmd
		.option("--service-key <key>", "SL_SERVICE_KEY override")
		.option("--base-url <url>", "SL_API_URL override") as T;
}

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

export async function resolveSubscriptionRef(
	client: SubscriptionClientLike,
	ref: string,
): Promise<ResolvedSubscription> {
	const { data } = await client.subscriptions.list();
	const idMatch = data.find((sub: SubscriptionSummary) => sub.id === ref);
	if (idMatch) {
		return {
			id: idMatch.id,
			detail: await client.subscriptions.get(idMatch.id),
		};
	}

	const nameMatches = data.filter(
		(sub: SubscriptionSummary) => sub.name === ref,
	);
	if (nameMatches.length > 1) {
		throw new Error(
			`Subscription name "${ref}" is ambiguous; use the subscription id.`,
		);
	}
	if (nameMatches[0]) {
		return {
			id: nameMatches[0].id,
			detail: await client.subscriptions.get(nameMatches[0].id),
		};
	}

	return {
		id: ref,
		detail: await client.subscriptions.get(ref),
	};
}

export function buildUpdatePatch(
	options: UpdateOptions,
): UpdateSubscriptionRequest {
	const patch: UpdateSubscriptionRequest = {};
	if (options.name) patch.name = options.name;
	if (options.url) patch.url = options.url;
	const authConfig = buildSubscriptionAuthConfig(options.authToken);
	if (authConfig) patch.authConfig = authConfig;
	if (options.format) {
		patch.format = options.format as UpdateSubscriptionRequest["format"];
	}
	if (options.runtime !== undefined) {
		patch.runtime =
			options.runtime === "none" || options.runtime === "null"
				? null
				: (options.runtime as NonNullable<
						UpdateSubscriptionRequest["runtime"]
					>);
	}
	if (options.clearFilter) patch.filter = {};
	if (options.filter) {
		if (options.clearFilter) {
			throw new Error("Use either --filter or --clear-filter, not both");
		}
		patch.filter = (parseSubscriptionFilter(options.filter) ??
			{}) as UpdateSubscriptionRequest["filter"];
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

function printSubscriptionDetail(sub: SubscriptionDetail): void {
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
	subscription: SubscriptionDetail;
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
	subscription: SubscriptionDetail;
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
	if (input.subscription.status === "paused") {
		hints.push(
			`Resume when the receiver is healthy: sl subscriptions resume ${input.subscription.id}`,
		);
	}
	if (input.subscription.lastError) {
		hints.push("Run sl subscriptions test to reproduce the receiver request.");
	}
	if (
		input.subscription.circuitOpenedAt ||
		input.subscription.circuitFailures > 0
	) {
		hints.push(
			"Circuit breaker has failures; inspect receiver logs and delivery status codes.",
		);
	}
	if (input.dead.length > 0) {
		hints.push(
			`Dead-letter rows exist; inspect with sl subscriptions dead ${input.subscription.id} and requeue selected rows.`,
		);
	}
	if (subgraph?.gapCount && subgraph.gapCount > 0) {
		hints.push(
			`Linked subgraph has gaps; run sl subgraphs gaps ${input.subscription.subgraphName}.`,
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
		subscription: input.subscription,
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
	const sub = report.subscription;
	console.log(
		formatKeyValue([
			["Subscription", `${sub.name} (${sub.id})`],
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

export function buildSubscriptionTestFixture(input: {
	subscription: Pick<
		SubscriptionDetail,
		"id" | "subgraphName" | "tableName" | "url"
	>;
	row: Record<string, unknown>;
	signingSecret: string;
	nowSeconds?: number;
	id?: string;
}): { body: string; headers: Record<string, string>; curl: string } {
	const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
	const body = JSON.stringify({
		type: `${input.subscription.subgraphName}.${input.subscription.tableName}.created`,
		timestamp: new Date(nowSeconds * 1000).toISOString(),
		data: input.row,
	});
	const headers = {
		"content-type": "application/json",
		...sign(body, input.signingSecret, {
			id: input.id ?? `test-${input.subscription.id}`,
			timestampSeconds: nowSeconds,
		}),
	};
	const headerArgs = Object.entries(headers)
		.map(([key, value]) => `  -H ${shellQuote(`${key}: ${value}`)} \\`)
		.join("\n");
	const curl = [
		`curl -X POST ${shellQuote(input.subscription.url)} \\`,
		headerArgs,
		`  --data ${shellQuote(body)}`,
	].join("\n");

	return { body, headers, curl };
}

async function representativeRow(
	client: SecondLayer,
	sub: SubscriptionDetail,
	subgraph: SubgraphDetail | null,
): Promise<Record<string, unknown>> {
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
	if (yes) return true;
	const ok = await confirm({ message });
	if (!ok) {
		info("Cancelled");
		return false;
	}
	return true;
}

export function registerSubscriptionsCommand(program: Command): void {
	const subscriptions = commonOptions(
		program
			.command("subscriptions")
			.alias("subs")
			.description("Manage subgraph table subscriptions"),
	);

	commonOptions(
		subscriptions
			.command("list")
			.alias("ls")
			.description("List subscriptions")
			.option("--json", "Output as JSON"),
	).action(async (options: CommonOptions) => {
		try {
			const client = await getSubscriptionClient(options);
			const { data } = await client.subscriptions.list();
			if (options.json) {
				printJson(data);
				return;
			}
			if (data.length === 0) {
				console.log(dim("No subscriptions"));
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
			console.log(dim(`\n${data.length} subscription(s) total`));
		} catch (err) {
			handleApiError(err, "list subscriptions");
		}
	});

	commonOptions(
		subscriptions
			.command("get <idOrName>")
			.description("Show subscription details")
			.option("--json", "Output as JSON"),
	).action(async (idOrName: string, options: CommonOptions) => {
		try {
			const client = await getSubscriptionClient(options);
			const { detail } = await resolveSubscriptionRef(client, idOrName);
			if (options.json) printJson(detail);
			else printSubscriptionDetail(detail);
		} catch (err) {
			handleApiError(err, "get subscription");
		}
	});

	commonOptions(
		subscriptions
			.command("update <idOrName>")
			.description("Update subscription config")
			.option("--name <name>", "Rename subscription")
			.option("--url <url>", "Webhook URL")
			.option("--auth-token <token>", "Set bearer token auth config")
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
			.option("--concurrency <n>", "Per-subscription delivery concurrency")
			.option("--json", "Output as JSON"),
	).action(async (idOrName: string, options: UpdateOptions) => {
		try {
			const client = await getSubscriptionClient(options);
			const patch = buildUpdatePatch(options);
			const { id, detail } = await resolveSubscriptionRef(client, idOrName);
			if (patch.filter !== undefined) {
				await validateSubscriptionTargetFromApi(client, {
					subgraphName: detail.subgraphName,
					tableName: detail.tableName,
					filter: patch.filter,
				});
			}
			const updated = await client.subscriptions.update(id, patch);
			if (options.json) printJson(updated);
			else success(`Updated subscription ${blue(updated.name)}`);
		} catch (err) {
			handleApiError(err, "update subscription");
		}
	});

	for (const action of ["pause", "resume"] as const) {
		commonOptions(
			subscriptions
				.command(`${action} <idOrName>`)
				.description(
					`${action === "pause" ? "Pause" : "Resume"} a subscription`,
				)
				.option("--json", "Output as JSON"),
		).action(async (idOrName: string, options: CommonOptions) => {
			try {
				const client = await getSubscriptionClient(options);
				const { id } = await resolveSubscriptionRef(client, idOrName);
				const updated = await client.subscriptions[action](id);
				if (options.json) printJson(updated);
				else
					success(
						`${action === "pause" ? "Paused" : "Resumed"} ${blue(updated.name)}`,
					);
			} catch (err) {
				handleApiError(err, `${action} subscription`);
			}
		});
	}

	commonOptions(
		subscriptions
			.command("delete <idOrName>")
			.description("Delete a subscription")
			.option("-y, --yes", "Skip confirmation")
			.option("--json", "Output as JSON"),
	).action(async (idOrName: string, options: CommonOptions) => {
		try {
			const client = await getSubscriptionClient(options);
			const { id, detail } = await resolveSubscriptionRef(client, idOrName);
			const ok = await confirmOrExit(
				`Delete subscription "${detail.name}"? Pending outbox rows will be removed.`,
				options.yes,
			);
			if (!ok) return;
			const res = await client.subscriptions.delete(id);
			if (options.json) printJson(res);
			else success(`Deleted subscription ${blue(detail.name)}`);
		} catch (err) {
			handleApiError(err, "delete subscription");
		}
	});

	commonOptions(
		subscriptions
			.command("rotate-secret <idOrName>")
			.description("Rotate the signing secret")
			.option("-y, --yes", "Skip confirmation")
			.option("--json", "Output as JSON"),
	).action(async (idOrName: string, options: CommonOptions) => {
		try {
			const client = await getSubscriptionClient(options);
			const { id, detail } = await resolveSubscriptionRef(client, idOrName);
			const ok = await confirmOrExit(
				`Rotate signing secret for "${detail.name}"? Existing receivers using the old secret will fail verification.`,
				options.yes,
			);
			if (!ok) return;
			const res = await client.subscriptions.rotateSecret(id);
			if (options.json) printJson(res);
			else {
				success(`Rotated signing secret for ${blue(res.subscription.name)}`);
				console.log(res.signingSecret);
			}
		} catch (err) {
			handleApiError(err, "rotate subscription secret");
		}
	});

	commonOptions(
		subscriptions
			.command("deliveries <idOrName>")
			.description("Show recent delivery attempts")
			.option("--json", "Output as JSON"),
	).action(async (idOrName: string, options: CommonOptions) => {
		try {
			const client = await getSubscriptionClient(options);
			const { id } = await resolveSubscriptionRef(client, idOrName);
			const { data } = await client.subscriptions.recentDeliveries(id);
			if (options.json) printJson(data);
			else printDeliveries(data);
		} catch (err) {
			handleApiError(err, "list subscription deliveries");
		}
	});

	commonOptions(
		subscriptions
			.command("dead <idOrName>")
			.description("Show dead-letter outbox rows")
			.option("--json", "Output as JSON"),
	).action(async (idOrName: string, options: CommonOptions) => {
		try {
			const client = await getSubscriptionClient(options);
			const { id } = await resolveSubscriptionRef(client, idOrName);
			const { data } = await client.subscriptions.dead(id);
			if (options.json) printJson(data);
			else printDead(data);
		} catch (err) {
			handleApiError(err, "list dead-letter rows");
		}
	});

	commonOptions(
		subscriptions
			.command("requeue <idOrName> <outboxId>")
			.description("Requeue one dead-letter row")
			.option("-y, --yes", "Skip confirmation")
			.option("--json", "Output as JSON"),
	).action(
		async (idOrName: string, outboxId: string, options: CommonOptions) => {
			try {
				const client = await getSubscriptionClient(options);
				const { id, detail } = await resolveSubscriptionRef(client, idOrName);
				const ok = await confirmOrExit(
					`Requeue ${outboxId} for "${detail.name}"?`,
					options.yes,
				);
				if (!ok) return;
				const res = await client.subscriptions.requeueDead(id, outboxId);
				if (options.json) printJson(res);
				else success(`Requeued ${blue(outboxId)}`);
			} catch (err) {
				handleApiError(err, "requeue dead-letter row");
			}
		},
	);

	commonOptions(
		subscriptions
			.command("replay <idOrName>")
			.description("Replay a block range")
			.requiredOption("--from-block <n>", "Start block height")
			.requiredOption("--to-block <n>", "End block height")
			.option("-y, --yes", "Skip confirmation")
			.option("--json", "Output as JSON"),
	).action(
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
				const client = await getSubscriptionClient(options);
				const { id, detail } = await resolveSubscriptionRef(client, idOrName);
				const ok = await confirmOrExit(
					`Replay ${detail.name} from block ${fromBlock} to ${toBlock}?`,
					options.yes,
				);
				if (!ok) return;
				const res = await client.subscriptions.replay(id, {
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
				handleApiError(err, "replay subscription");
			}
		},
	);

	commonOptions(
		subscriptions
			.command("doctor <idOrName>")
			.description("Diagnose subscription health and next steps")
			.option("--json", "Output as JSON"),
	).action(async (idOrName: string, options: CommonOptions) => {
		try {
			const client = await getSubscriptionClient(options);
			const { id, detail } = await resolveSubscriptionRef(client, idOrName);
			const [deliveries, dead, subgraph] = await Promise.allSettled([
				client.subscriptions.recentDeliveries(id),
				client.subscriptions.dead(id),
				client.subgraphs.get(detail.subgraphName),
			]);
			const report = buildDoctorReport({
				subscription: detail,
				deliveries:
					deliveries.status === "fulfilled" ? deliveries.value.data : [],
				dead: dead.status === "fulfilled" ? dead.value.data : [],
				subgraph: subgraph.status === "fulfilled" ? subgraph.value : null,
			});
			if (options.json) printJson(report);
			else printDoctorReport(report);
		} catch (err) {
			handleApiError(err, "diagnose subscription");
		}
	});

	commonOptions(
		subscriptions
			.command("test <idOrName>")
			.description(
				"Build and optionally POST a signed Standard Webhooks fixture",
			)
			.option("--signing-secret <secret>", "Signing secret override")
			.option("--post", "POST the fixture to the subscription URL")
			.option("--json", "Output as JSON"),
	).action(async (idOrName: string, options: TestOptions) => {
		try {
			const signingSecret = resolveSigningSecret(options);
			const client = await getSubscriptionClient(options);
			const { detail } = await resolveSubscriptionRef(client, idOrName);
			const subgraph = await client.subgraphs
				.get(detail.subgraphName)
				.catch(() => null);
			const row = await representativeRow(client, detail, subgraph);
			const fixture = buildSubscriptionTestFixture({
				subscription: detail,
				row,
				signingSecret,
			});
			let postResult: { status: number; body: string } | null = null;
			if (options.post) {
				const res = await fetch(detail.url, {
					method: "POST",
					headers: fixture.headers,
					body: fixture.body,
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
				console.log(dim("\nPOST result:"));
				console.log(`Status: ${postResult.status}`);
				if (postResult.body) console.log(postResult.body);
			}
		} catch (err) {
			handleApiError(err, "test subscription");
		}
	});
}
