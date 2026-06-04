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

// --- Chain triggers (direct chain-level subscriptions) -----------------------
// A chain subscription reacts to raw chain events matched directly off the
// Index/Streams clock (no subgraph). `triggers` is an array of these filters —
// the JSON mirror of the subgraph runtime's `SubgraphFilter` union. Defined
// here (not imported from @secondlayer/subgraphs) to avoid a shared→subgraphs
// cycle; the evaluator maps these to `SubgraphFilter` at match time. Amounts are
// non-negative integer strings (uint128 can exceed JS safe-int) or numbers.

export const CHAIN_TRIGGER_TYPES = [
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"contract_call",
	"contract_deploy",
	"print_event",
] as const;

const triggerAmount = z.union([
	z.string().trim().regex(/^\d+$/, "must be a non-negative integer string"),
	z.number().int().nonnegative(),
]);
/** Principal/identifier/name patterns — `*` wildcards allowed (matched by the
 *  evaluator). */
const triggerPattern = z.string().trim().min(1);
const trait = z.string().trim().min(1);

export const ChainTriggerSchema: z.ZodType<ChainTrigger> = z.discriminatedUnion(
	"type",
	[
		z
			.object({
				type: z.literal("stx_transfer"),
				sender: triggerPattern.optional(),
				recipient: triggerPattern.optional(),
				minAmount: triggerAmount.optional(),
				maxAmount: triggerAmount.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("stx_mint"),
				recipient: triggerPattern.optional(),
				minAmount: triggerAmount.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("stx_burn"),
				sender: triggerPattern.optional(),
				minAmount: triggerAmount.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("stx_lock"),
				lockedAddress: triggerPattern.optional(),
				minAmount: triggerAmount.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("ft_transfer"),
				assetIdentifier: triggerPattern.optional(),
				sender: triggerPattern.optional(),
				recipient: triggerPattern.optional(),
				minAmount: triggerAmount.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("ft_mint"),
				assetIdentifier: triggerPattern.optional(),
				recipient: triggerPattern.optional(),
				minAmount: triggerAmount.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("ft_burn"),
				assetIdentifier: triggerPattern.optional(),
				sender: triggerPattern.optional(),
				minAmount: triggerAmount.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("nft_transfer"),
				assetIdentifier: triggerPattern.optional(),
				sender: triggerPattern.optional(),
				recipient: triggerPattern.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("nft_mint"),
				assetIdentifier: triggerPattern.optional(),
				recipient: triggerPattern.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("nft_burn"),
				assetIdentifier: triggerPattern.optional(),
				sender: triggerPattern.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("contract_call"),
				contractId: triggerPattern.optional(),
				functionName: triggerPattern.optional(),
				caller: triggerPattern.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("contract_deploy"),
				deployer: triggerPattern.optional(),
				contractName: triggerPattern.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("print_event"),
				contractId: triggerPattern.optional(),
				topic: triggerPattern.optional(),
				trait: trait.optional(),
			})
			.strict(),
	],
);

export const ChainTriggersSchema: z.ZodType<ChainTrigger[]> = z
	.array(ChainTriggerSchema)
	.min(1)
	.max(50);

export const CreateSubscriptionRequestSchema: z.ZodType<ParsedCreateSubscriptionRequest> =
	z
		.object({
			name,
			// Subgraph mode (kind=subgraph): subgraphName + tableName + optional filter.
			subgraphName: resourceName.optional(),
			tableName: resourceName.optional(),
			filter: SubscriptionFilterSchema.optional(),
			// Chain mode (kind=chain): triggers.
			triggers: ChainTriggersSchema.optional(),
			url: webhookUrl,
			format: SubscriptionFormatSchema.default("standard-webhooks"),
			runtime: SubscriptionRuntimeSchema.nullable().optional(),
			authConfig: z.record(z.string(), z.unknown()).optional(),
			maxRetries: z.number().int().min(0).max(100).optional(),
			timeoutMs: z.number().int().min(100).max(300_000).optional(),
			concurrency: z.number().int().min(1).max(100).optional(),
		})
		.refine(
			(v) => {
				const subgraphMode =
					v.subgraphName !== undefined || v.tableName !== undefined;
				const chainMode = v.triggers !== undefined;
				if (chainMode && subgraphMode) return false;
				if (chainMode) return true;
				// Subgraph mode requires BOTH subgraphName and tableName.
				return v.subgraphName !== undefined && v.tableName !== undefined;
			},
			{
				message:
					"provide either { subgraphName, tableName } for a subgraph subscription OR { triggers } for a chain subscription — not both",
			},
		)
		.refine((v) => v.filter === undefined || v.triggers === undefined, {
			message:
				"`filter` applies to subgraph subscriptions; chain subscriptions use `triggers`",
			path: ["filter"],
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
/** Polymorphic subscription mode (mirrors db/types `SubscriptionKind`). */
export type SubscriptionKind = "subgraph" | "chain";
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

export type ChainTriggerType = (typeof CHAIN_TRIGGER_TYPES)[number];
/** Non-negative integer amount over JSON (string for uint128 safety, or number). */
export type ChainTriggerAmount = string | number;

interface TraitScoped {
	trait?: string;
}

/** JSON mirror of the subgraph runtime's `SubgraphFilter` union. */
export type ChainTrigger =
	| {
			type: "stx_transfer";
			sender?: string;
			recipient?: string;
			minAmount?: ChainTriggerAmount;
			maxAmount?: ChainTriggerAmount;
	  }
	| { type: "stx_mint"; recipient?: string; minAmount?: ChainTriggerAmount }
	| { type: "stx_burn"; sender?: string; minAmount?: ChainTriggerAmount }
	| {
			type: "stx_lock";
			lockedAddress?: string;
			minAmount?: ChainTriggerAmount;
	  }
	| ({
			type: "ft_transfer";
			assetIdentifier?: string;
			sender?: string;
			recipient?: string;
			minAmount?: ChainTriggerAmount;
	  } & TraitScoped)
	| ({
			type: "ft_mint";
			assetIdentifier?: string;
			recipient?: string;
			minAmount?: ChainTriggerAmount;
	  } & TraitScoped)
	| ({
			type: "ft_burn";
			assetIdentifier?: string;
			sender?: string;
			minAmount?: ChainTriggerAmount;
	  } & TraitScoped)
	| ({
			type: "nft_transfer";
			assetIdentifier?: string;
			sender?: string;
			recipient?: string;
	  } & TraitScoped)
	| ({
			type: "nft_mint";
			assetIdentifier?: string;
			recipient?: string;
	  } & TraitScoped)
	| ({
			type: "nft_burn";
			assetIdentifier?: string;
			sender?: string;
	  } & TraitScoped)
	| ({
			type: "contract_call";
			contractId?: string;
			functionName?: string;
			caller?: string;
	  } & TraitScoped)
	| { type: "contract_deploy"; deployer?: string; contractName?: string }
	| ({
			type: "print_event";
			contractId?: string;
			topic?: string;
	  } & TraitScoped);

/** Args for a chain-trigger builder — every field of a variant except `type`. */
type TriggerArgs<T extends ChainTrigger["type"]> = Omit<
	Extract<ChainTrigger, { type: T }>,
	"type"
>;

/**
 * Ergonomic chain-trigger constructors for `subscriptions.create({ triggers })`.
 * Each returns a bare `ChainTrigger` (the wire shape the API expects):
 *
 * ```ts
 * client.subscriptions.create({
 *   url: "https://my.app/webhook",
 *   triggers: [trigger.contractCall({ contractId: "SP....amm", functionName: "swap-*" })],
 * });
 * ```
 */
export const trigger = {
	stxTransfer: (f: TriggerArgs<"stx_transfer"> = {}): ChainTrigger => ({
		type: "stx_transfer",
		...f,
	}),
	stxMint: (f: TriggerArgs<"stx_mint"> = {}): ChainTrigger => ({
		type: "stx_mint",
		...f,
	}),
	stxBurn: (f: TriggerArgs<"stx_burn"> = {}): ChainTrigger => ({
		type: "stx_burn",
		...f,
	}),
	stxLock: (f: TriggerArgs<"stx_lock"> = {}): ChainTrigger => ({
		type: "stx_lock",
		...f,
	}),
	ftTransfer: (f: TriggerArgs<"ft_transfer"> = {}): ChainTrigger => ({
		type: "ft_transfer",
		...f,
	}),
	ftMint: (f: TriggerArgs<"ft_mint"> = {}): ChainTrigger => ({
		type: "ft_mint",
		...f,
	}),
	ftBurn: (f: TriggerArgs<"ft_burn"> = {}): ChainTrigger => ({
		type: "ft_burn",
		...f,
	}),
	nftTransfer: (f: TriggerArgs<"nft_transfer"> = {}): ChainTrigger => ({
		type: "nft_transfer",
		...f,
	}),
	nftMint: (f: TriggerArgs<"nft_mint"> = {}): ChainTrigger => ({
		type: "nft_mint",
		...f,
	}),
	nftBurn: (f: TriggerArgs<"nft_burn"> = {}): ChainTrigger => ({
		type: "nft_burn",
		...f,
	}),
	contractCall: (f: TriggerArgs<"contract_call"> = {}): ChainTrigger => ({
		type: "contract_call",
		...f,
	}),
	contractDeploy: (f: TriggerArgs<"contract_deploy"> = {}): ChainTrigger => ({
		type: "contract_deploy",
		...f,
	}),
	printEvent: (f: TriggerArgs<"print_event"> = {}): ChainTrigger => ({
		type: "print_event",
		...f,
	}),
} as const;

export interface CreateSubscriptionRequest {
	name: string;
	/** Subgraph mode. */
	subgraphName?: string;
	tableName?: string;
	filter?: SubscriptionFilter;
	/** Chain mode. */
	triggers?: ChainTrigger[];
	url: string;
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
	kind: SubscriptionKind;
	/** Null for chain subscriptions. */
	subgraphName: string | null;
	/** Null for chain subscriptions. */
	tableName: string | null;
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
	/** Chain-trigger filters (chain subscriptions only). */
	triggers: ChainTrigger[] | null;
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
