import { z } from "zod/v4";

export const SUBSCRIPTION_FORMATS = [
	"standard-webhooks",
	"inngest",
	"trigger",
	"cloudflare",
	"cloudevents",
	"raw",
] as const;

export const SUBSCRIPTION_RUNTIMES = [
	"inngest",
	"trigger",
	"cloudflare",
	"node",
] as const;

export const SUBSCRIPTION_STATUSES = ["active", "paused", "error"] as const;

export const SUBSCRIPTION_FILTER_OPERATORS = [
	"eq",
	"neq",
	"gt",
	"gte",
	"lt",
	"lte",
	"in",
] as const;

const webhookUrl = z
	.string()
	.trim()
	.min(1)
	.refine(
		(value) => value.startsWith("http://") || value.startsWith("https://"),
		"must be an http(s) URL",
	);

const name = z.string().trim().min(1).max(128);
const resourceName = z.string().trim().min(1).max(128);

export const SubscriptionStatusSchema: z.ZodType<SubscriptionStatus> = z.enum(
	SUBSCRIPTION_STATUSES,
);
export const SubscriptionFormatSchema: z.ZodType<SubscriptionFormat> =
	z.enum(SUBSCRIPTION_FORMATS);
export const SubscriptionRuntimeSchema: z.ZodType<SubscriptionRuntime> = z.enum(
	SUBSCRIPTION_RUNTIMES,
);

export const SubscriptionFilterPrimitiveSchema: z.ZodType<SubscriptionFilterPrimitive> =
	z.union([z.string(), z.number().finite(), z.boolean()]);

export const SubscriptionFilterOperatorSchema: z.ZodType<SubscriptionFilterOperator> =
	z.union([
		z.object({ eq: SubscriptionFilterPrimitiveSchema }).strict(),
		z.object({ neq: SubscriptionFilterPrimitiveSchema }).strict(),
		z.object({ gt: z.union([z.string(), z.number().finite()]) }).strict(),
		z.object({ gte: z.union([z.string(), z.number().finite()]) }).strict(),
		z.object({ lt: z.union([z.string(), z.number().finite()]) }).strict(),
		z.object({ lte: z.union([z.string(), z.number().finite()]) }).strict(),
		z
			.object({
				in: z.array(SubscriptionFilterPrimitiveSchema).min(1),
			})
			.strict(),
	]);

export const SubscriptionFilterClauseSchema: z.ZodType<SubscriptionFilterClause> =
	z.union([
		SubscriptionFilterPrimitiveSchema,
		SubscriptionFilterOperatorSchema,
	]);

export const SubscriptionFilterSchema: z.ZodType<SubscriptionFilter> = z.record(
	z.string().min(1),
	SubscriptionFilterClauseSchema,
);

export const CreateSubscriptionRequestSchema: z.ZodType<ParsedCreateSubscriptionRequest> =
	z.object({
		name,
		subgraphName: resourceName,
		tableName: resourceName,
		url: webhookUrl,
		filter: SubscriptionFilterSchema.optional(),
		format: SubscriptionFormatSchema.default("standard-webhooks"),
		runtime: SubscriptionRuntimeSchema.nullable().optional(),
		authConfig: z.record(z.string(), z.unknown()).optional(),
		maxRetries: z.number().int().min(0).max(100).optional(),
		timeoutMs: z.number().int().min(100).max(300_000).optional(),
		concurrency: z.number().int().min(1).max(100).optional(),
	});

export const UpdateSubscriptionRequestSchema: z.ZodType<UpdateSubscriptionRequest> =
	z
		.object({
			name: name.optional(),
			url: webhookUrl.optional(),
			filter: SubscriptionFilterSchema.optional(),
			format: SubscriptionFormatSchema.optional(),
			runtime: SubscriptionRuntimeSchema.nullable().optional(),
			authConfig: z.record(z.string(), z.unknown()).optional(),
			maxRetries: z.number().int().min(0).max(100).optional(),
			timeoutMs: z.number().int().min(100).max(300_000).optional(),
			concurrency: z.number().int().min(1).max(100).optional(),
		})
		.refine((value) => Object.keys(value).length > 0, {
			message: "At least one field must be provided",
		});

export const ReplaySubscriptionRequestSchema: z.ZodType<ReplaySubscriptionRequest> =
	z
		.object({
			fromBlock: z.number().int().nonnegative(),
			toBlock: z.number().int().nonnegative(),
			force: z.string().trim().min(1).max(64).optional(),
		})
		.refine((value) => value.fromBlock <= value.toBlock, {
			message: "fromBlock must be less than or equal to toBlock",
			path: ["toBlock"],
		});

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type SubscriptionFormat = (typeof SUBSCRIPTION_FORMATS)[number];
export type SubscriptionRuntime = (typeof SUBSCRIPTION_RUNTIMES)[number];
export type SubscriptionFilterPrimitive = string | number | boolean;
export type SubscriptionFilterOperator =
	| { eq: SubscriptionFilterPrimitive }
	| { neq: SubscriptionFilterPrimitive }
	| { gt: string | number }
	| { gte: string | number }
	| { lt: string | number }
	| { lte: string | number }
	| { in: SubscriptionFilterPrimitive[] };
export type SubscriptionFilterClause =
	| SubscriptionFilterPrimitive
	| SubscriptionFilterOperator;
export type SubscriptionFilter = Record<string, SubscriptionFilterClause>;

export interface CreateSubscriptionRequest {
	name: string;
	subgraphName: string;
	tableName: string;
	url: string;
	filter?: SubscriptionFilter;
	format?: SubscriptionFormat;
	runtime?: SubscriptionRuntime | null;
	authConfig?: Record<string, unknown>;
	maxRetries?: number;
	timeoutMs?: number;
	concurrency?: number;
}

export interface ParsedCreateSubscriptionRequest
	extends Omit<CreateSubscriptionRequest, "format"> {
	format: SubscriptionFormat;
}

export interface UpdateSubscriptionRequest {
	name?: string;
	url?: string;
	filter?: SubscriptionFilter;
	format?: SubscriptionFormat;
	runtime?: SubscriptionRuntime | null;
	authConfig?: Record<string, unknown>;
	maxRetries?: number;
	timeoutMs?: number;
	concurrency?: number;
}

export type ParsedUpdateSubscriptionRequest = UpdateSubscriptionRequest;

export interface ReplaySubscriptionRequest {
	fromBlock: number;
	toBlock: number;
	force?: string;
}

export type ParsedReplaySubscriptionRequest = ReplaySubscriptionRequest;

export interface SubscriptionSummary {
	id: string;
	name: string;
	status: SubscriptionStatus;
	subgraphName: string;
	tableName: string;
	format: SubscriptionFormat;
	runtime: SubscriptionRuntime | null;
	url: string;
	lastDeliveryAt: string | null;
	lastSuccessAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface SubscriptionDetail extends SubscriptionSummary {
	filter: Record<string, unknown>;
	authConfig: Record<string, unknown>;
	maxRetries: number;
	timeoutMs: number;
	concurrency: number;
	circuitFailures: number;
	circuitOpenedAt: string | null;
	lastError: string | null;
}

export interface CreateSubscriptionResponse {
	subscription: SubscriptionDetail;
	/** Plaintext signing secret — surfaced ONCE. Store it server-side. */
	signingSecret: string;
}

export interface RotateSecretResponse {
	subscription: SubscriptionDetail;
	signingSecret: string;
}

export interface DeliveryRow {
	id: string;
	attempt: number;
	statusCode: number | null;
	errorMessage: string | null;
	durationMs: number | null;
	responseBody: string | null;
	dispatchedAt: string;
}

export interface ReplayResult {
	replayId: string;
	enqueuedCount: number;
	scannedCount: number;
}

export interface DeadRow {
	id: string;
	eventType: string;
	attempt: number;
	blockHeight: number;
	txId: string | null;
	payload: Record<string, unknown>;
	failedAt: string | null;
	createdAt: string;
}

export interface SubscriptionSchemaColumn {
	type?: unknown;
}

export interface SubscriptionSchemaTable {
	columns: Record<string, SubscriptionSchemaColumn>;
}

export type SubscriptionSchemaTables = Record<string, SubscriptionSchemaTable>;

const SCALAR_COLUMN_TYPES = new Set([
	"text",
	"uint",
	"int",
	"principal",
	"boolean",
	"timestamp",
]);

const COMPARISON_COLUMN_TYPES = new Set(["uint", "int", "timestamp"]);

function formatIssuePath(path: PropertyKey[]): string {
	return path.length > 0 ? `${path.map(String).join(".")}: ` : "";
}

export function formatSubscriptionSchemaErrors(error: z.ZodError): string[] {
	return error.issues.map(
		(issue) => `${formatIssuePath(issue.path)}${issue.message}`,
	);
}

function operatorForClause(clause: SubscriptionFilterClause): string {
	if (clause === null || typeof clause !== "object" || Array.isArray(clause)) {
		return "eq";
	}
	return Object.keys(clause)[0] ?? "eq";
}

export function validateSubscriptionFilterForTable(input: {
	subgraphName?: string;
	tableName: string;
	filter?: unknown;
	tables: SubscriptionSchemaTables;
}): string[] {
	const errors: string[] = [];
	const table = input.tables[input.tableName];
	if (!table) {
		const names = Object.keys(input.tables);
		errors.push(
			`Unknown table "${input.tableName}"${
				input.subgraphName ? ` in subgraph "${input.subgraphName}"` : ""
			}.${names.length > 0 ? ` Available tables: ${names.join(", ")}.` : ""}`,
		);
		return errors;
	}

	if (input.filter === undefined) return errors;

	const parsed = SubscriptionFilterSchema.safeParse(input.filter);
	if (!parsed.success) {
		return formatSubscriptionSchemaErrors(parsed.error);
	}

	for (const [field, clause] of Object.entries(parsed.data)) {
		const column = table.columns[field];
		if (!column) {
			errors.push(
				`Unknown filter field "${field}" on table "${input.tableName}".`,
			);
			continue;
		}

		const columnType =
			typeof column.type === "string" ? column.type.toLowerCase() : "";
		if (!SCALAR_COLUMN_TYPES.has(columnType)) {
			errors.push(
				`Filter field "${field}" has unsupported type "${columnType || "unknown"}"; subscription filters require scalar columns.`,
			);
			continue;
		}

		const operator = operatorForClause(clause);
		if (
			(operator === "gt" ||
				operator === "gte" ||
				operator === "lt" ||
				operator === "lte") &&
			!COMPARISON_COLUMN_TYPES.has(columnType)
		) {
			errors.push(
				`Operator "${operator}" is not supported for ${columnType} field "${field}".`,
			);
		}
	}

	return errors;
}
