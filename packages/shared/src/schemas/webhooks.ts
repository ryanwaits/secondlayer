import { z } from "zod";

export const WEBHOOK_FORMATS = [
	"standard-webhooks",
	"inngest",
	"trigger",
	"cloudflare",
	"cloudevents",
	"raw",
] as const;

export const WEBHOOK_RUNTIMES = [
	"inngest",
	"trigger",
	"cloudflare",
	"node",
] as const;

export const WEBHOOK_STATUSES = ["active", "paused", "error"] as const;

/**
 * Delivery-cap ceilings. Self-host defaults keep today's hardcoded limits
 * (100 retries, 300s timeout); an operator raises or lowers them per env.
 * Read live (not baked in at import) so a changed env var takes effect on
 * the next request without a process restart, and so tests can override
 * per-case.
 */
export const WEBHOOK_MAX_RETRIES_CEILING_DEFAULT = 100;
export const WEBHOOK_TIMEOUT_MS_CEILING_DEFAULT = 300_000;

function ceilingFromEnv(envVar: string, fallback: number): number {
	const raw = process.env[envVar];
	if (raw === undefined) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function webhookMaxRetriesCeiling(): number {
	return ceilingFromEnv(
		"WEBHOOK_MAX_RETRIES_CEILING",
		WEBHOOK_MAX_RETRIES_CEILING_DEFAULT,
	);
}

export function webhookTimeoutMsCeiling(): number {
	return ceilingFromEnv(
		"WEBHOOK_TIMEOUT_MS_CEILING",
		WEBHOOK_TIMEOUT_MS_CEILING_DEFAULT,
	);
}

function maxRetriesField() {
	return z
		.number()
		.int()
		.min(0)
		.optional()
		.superRefine((v, ctx) => {
			if (v === undefined) return;
			const ceiling = webhookMaxRetriesCeiling();
			if (v > ceiling) {
				ctx.addIssue({
					code: "custom",
					message: `maxRetries exceeds ceiling (${ceiling})`,
				});
			}
		});
}

function timeoutMsField() {
	return z
		.number()
		.int()
		.min(100)
		.optional()
		.superRefine((v, ctx) => {
			if (v === undefined) return;
			const ceiling = webhookTimeoutMsCeiling();
			if (v > ceiling) {
				ctx.addIssue({
					code: "custom",
					message: `timeoutMs exceeds ceiling (${ceiling})`,
				});
			}
		});
}

export const WEBHOOK_FILTER_OPERATORS = [
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

export const WebhookStatusSchema: z.ZodType<WebhookStatus> =
	z.enum(WEBHOOK_STATUSES);
export const WebhookFormatSchema: z.ZodType<WebhookFormat> =
	z.enum(WEBHOOK_FORMATS);
export const WebhookRuntimeSchema: z.ZodType<WebhookRuntime> =
	z.enum(WEBHOOK_RUNTIMES);

export const WebhookFilterPrimitiveSchema: z.ZodType<WebhookFilterPrimitive> =
	z.union([z.string(), z.number().finite(), z.boolean()]);

export const WebhookFilterOperatorSchema: z.ZodType<WebhookFilterOperator> =
	z.union([
		z.object({ eq: WebhookFilterPrimitiveSchema }).strict(),
		z.object({ neq: WebhookFilterPrimitiveSchema }).strict(),
		z.object({ gt: z.union([z.string(), z.number().finite()]) }).strict(),
		z.object({ gte: z.union([z.string(), z.number().finite()]) }).strict(),
		z.object({ lt: z.union([z.string(), z.number().finite()]) }).strict(),
		z.object({ lte: z.union([z.string(), z.number().finite()]) }).strict(),
		z
			.object({
				in: z.array(WebhookFilterPrimitiveSchema).min(1),
			})
			.strict(),
	]);

export const WebhookFilterClauseSchema: z.ZodType<WebhookFilterClause> =
	z.union([WebhookFilterPrimitiveSchema, WebhookFilterOperatorSchema]);

export const WebhookFilterSchema: z.ZodType<WebhookFilter> = z.record(
	z.string().min(1),
	WebhookFilterClauseSchema,
);

// --- Chain triggers (direct chain-level webhooks) -----------------------
// A chain webhook reacts to raw chain events matched directly off the
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
	"nested_contract_call",
	"var_set",
	"map_set",
	"map_insert",
	"map_delete",
	"sbtc_deposit",
	"sbtc_withdrawal_create",
	"sbtc_withdrawal_accept",
	"sbtc_withdrawal_reject",
	"sbtc_withdrawal_swept_confirmed",
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
		z
			.object({
				type: z.literal("nested_contract_call"),
				contractId: triggerPattern.optional(),
				functionName: triggerPattern.optional(),
				caller: triggerPattern.optional(),
				sender: triggerPattern.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("var_set"),
				contractId: triggerPattern.optional(),
				varName: triggerPattern.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("map_set"),
				contractId: triggerPattern.optional(),
				map: triggerPattern.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("map_insert"),
				contractId: triggerPattern.optional(),
				map: triggerPattern.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("map_delete"),
				contractId: triggerPattern.optional(),
				map: triggerPattern.optional(),
				trait: trait.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("sbtc_deposit"),
				sender: triggerPattern.optional(),
				minAmount: triggerAmount.optional(),
				maxAmount: triggerAmount.optional(),
				bitcoinTxid: triggerPattern.optional(),
				requestId: z.number().int().nonnegative().optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("sbtc_withdrawal_create"),
				sender: triggerPattern.optional(),
				minAmount: triggerAmount.optional(),
				maxAmount: triggerAmount.optional(),
				requestId: z.number().int().nonnegative().optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("sbtc_withdrawal_accept"),
				requestId: z.number().int().nonnegative().optional(),
				sweepTxid: triggerPattern.optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("sbtc_withdrawal_reject"),
				requestId: z.number().int().nonnegative().optional(),
			})
			.strict(),
		z
			.object({
				type: z.literal("sbtc_withdrawal_swept_confirmed"),
				requestId: z.number().int().nonnegative().optional(),
				sweepTxid: triggerPattern.optional(),
			})
			.strict(),
	],
);

export const ChainTriggersSchema: z.ZodType<ChainTrigger[]> = z
	.array(ChainTriggerSchema)
	.min(1)
	.max(50);

/**
 * Per-type accepted filter fields for chain triggers, DERIVED from
 * {@link ChainTriggerSchema} so the agent-facing reference can never drift behind
 * the validator. `{ stx_transfer: ["sender","recipient","minAmount","maxAmount"], ... }`.
 */
export const CHAIN_TRIGGER_FIELDS: Record<string, string[]> =
	Object.fromEntries(
		// biome-ignore lint/suspicious/noExplicitAny: zod-internal introspection of this module's own discriminated union
		((ChainTriggerSchema as any)._zod.def.options as any[]).map((opt) => {
			const shape = opt._zod.def.shape as Record<string, unknown>;
			// biome-ignore lint/suspicious/noExplicitAny: literal value lives on the zod-internal def
			const type = (shape.type as any)._zod.def.values[0] as string;
			return [type, Object.keys(shape).filter((k) => k !== "type")];
		}),
	);

export const CreateWebhookRequestSchema: z.ZodType<ParsedCreateWebhookRequest> =
	z
		.object({
			name,
			// Subgraph mode (kind=subgraph): subgraphName + tableName + optional filter.
			subgraphName: resourceName.optional(),
			tableName: resourceName.optional(),
			filter: WebhookFilterSchema.optional(),
			// Chain mode (kind=chain): triggers.
			triggers: ChainTriggersSchema.optional(),
			url: webhookUrl,
			format: WebhookFormatSchema.default("standard-webhooks"),
			runtime: WebhookRuntimeSchema.nullable().optional(),
			authConfig: z.record(z.string(), z.unknown()).optional(),
			maxRetries: maxRetriesField(),
			timeoutMs: timeoutMsField(),
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
					"provide either { subgraphName, tableName } for a subgraph webhook OR { triggers } for a chain webhook — not both",
			},
		)
		.refine((v) => v.filter === undefined || v.triggers === undefined, {
			message:
				"`filter` applies to subgraph webhooks; chain webhooks use `triggers`",
			path: ["filter"],
		});

export const UpdateWebhookRequestSchema: z.ZodType<UpdateWebhookRequest> = z
	.object({
		name: name.optional(),
		url: webhookUrl.optional(),
		filter: WebhookFilterSchema.optional(),
		format: WebhookFormatSchema.optional(),
		runtime: WebhookRuntimeSchema.nullable().optional(),
		authConfig: z.record(z.string(), z.unknown()).optional(),
		maxRetries: maxRetriesField(),
		timeoutMs: timeoutMsField(),
		concurrency: z.number().int().min(1).max(100).optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one field must be provided",
	});

export const ReplayWebhookRequestSchema: z.ZodType<ReplayWebhookRequest> = z
	.object({
		fromBlock: z.number().int().nonnegative(),
		toBlock: z.number().int().nonnegative(),
		force: z.string().trim().min(1).max(64).optional(),
	})
	.refine((value) => value.fromBlock <= value.toBlock, {
		message: "fromBlock must be less than or equal to toBlock",
		path: ["toBlock"],
	});

export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];
/** Polymorphic webhook mode (mirrors db/types `WebhookKind`). */
export type WebhookKind = "subgraph" | "chain";
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];
export type WebhookRuntime = (typeof WEBHOOK_RUNTIMES)[number];
export type WebhookFilterPrimitive = string | number | boolean;
export type WebhookFilterOperator =
	| { eq: WebhookFilterPrimitive }
	| { neq: WebhookFilterPrimitive }
	| { gt: string | number }
	| { gte: string | number }
	| { lt: string | number }
	| { lte: string | number }
	| { in: WebhookFilterPrimitive[] };
export type WebhookFilterClause =
	| WebhookFilterPrimitive
	| WebhookFilterOperator;
export type WebhookFilter = Record<string, WebhookFilterClause>;

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
	  } & TraitScoped)
	| ({
			type: "nested_contract_call";
			contractId?: string;
			functionName?: string;
			caller?: string;
			sender?: string;
	  } & TraitScoped)
	| ({
			type: "var_set";
			contractId?: string;
			varName?: string;
	  } & TraitScoped)
	| ({
			type: "map_set";
			contractId?: string;
			map?: string;
	  } & TraitScoped)
	| ({
			type: "map_insert";
			contractId?: string;
			map?: string;
	  } & TraitScoped)
	| ({
			type: "map_delete";
			contractId?: string;
			map?: string;
	  } & TraitScoped)
	| {
			type: "sbtc_deposit";
			sender?: string;
			minAmount?: ChainTriggerAmount;
			maxAmount?: ChainTriggerAmount;
			bitcoinTxid?: string;
			requestId?: number;
	  }
	| {
			type: "sbtc_withdrawal_create";
			sender?: string;
			minAmount?: ChainTriggerAmount;
			maxAmount?: ChainTriggerAmount;
			requestId?: number;
	  }
	| {
			type: "sbtc_withdrawal_accept";
			requestId?: number;
			sweepTxid?: string;
	  }
	| { type: "sbtc_withdrawal_reject"; requestId?: number }
	| {
			type: "sbtc_withdrawal_swept_confirmed";
			requestId?: number;
			sweepTxid?: string;
	  };

/** Args for a chain-trigger builder — every field of a variant except `type`. */
type TriggerArgs<T extends ChainTrigger["type"]> = Omit<
	Extract<ChainTrigger, { type: T }>,
	"type"
>;

/**
 * Ergonomic chain-trigger constructors for `webhooks.create({ triggers })`.
 * Each returns a bare `ChainTrigger` (the wire shape the API expects):
 *
 * ```ts
 * client.webhooks.create({
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
	sbtcDeposit: (f: TriggerArgs<"sbtc_deposit"> = {}): ChainTrigger => ({
		type: "sbtc_deposit",
		...f,
	}),
	sbtcWithdrawalCreate: (
		f: TriggerArgs<"sbtc_withdrawal_create"> = {},
	): ChainTrigger => ({
		type: "sbtc_withdrawal_create",
		...f,
	}),
	sbtcWithdrawalAccept: (
		f: TriggerArgs<"sbtc_withdrawal_accept"> = {},
	): ChainTrigger => ({
		type: "sbtc_withdrawal_accept",
		...f,
	}),
	sbtcWithdrawalReject: (
		f: TriggerArgs<"sbtc_withdrawal_reject"> = {},
	): ChainTrigger => ({
		type: "sbtc_withdrawal_reject",
		...f,
	}),
	sbtcWithdrawalSweptConfirmed: (
		f: TriggerArgs<"sbtc_withdrawal_swept_confirmed"> = {},
	): ChainTrigger => ({
		type: "sbtc_withdrawal_swept_confirmed",
		...f,
	}),
} as const;

export interface CreateWebhookRequest {
	name: string;
	/** Subgraph mode. */
	subgraphName?: string;
	tableName?: string;
	filter?: WebhookFilter;
	/** Chain mode. */
	triggers?: ChainTrigger[];
	url: string;
	format?: WebhookFormat;
	runtime?: WebhookRuntime | null;
	authConfig?: Record<string, unknown>;
	maxRetries?: number;
	timeoutMs?: number;
	concurrency?: number;
}

export interface ParsedCreateWebhookRequest
	extends Omit<CreateWebhookRequest, "format"> {
	format: WebhookFormat;
}

export interface UpdateWebhookRequest {
	name?: string;
	url?: string;
	filter?: WebhookFilter;
	format?: WebhookFormat;
	runtime?: WebhookRuntime | null;
	authConfig?: Record<string, unknown>;
	maxRetries?: number;
	timeoutMs?: number;
	concurrency?: number;
}

export type ParsedUpdateWebhookRequest = UpdateWebhookRequest;

export interface ReplayWebhookRequest {
	fromBlock: number;
	toBlock: number;
	force?: string;
}

export type ParsedReplayWebhookRequest = ReplayWebhookRequest;

export interface WebhookSummary {
	id: string;
	name: string;
	status: WebhookStatus;
	kind: WebhookKind;
	/** Null for chain webhooks. */
	subgraphName: string | null;
	/** Null for chain webhooks. */
	tableName: string | null;
	format: WebhookFormat;
	runtime: WebhookRuntime | null;
	url: string;
	lastDeliveryAt: string | null;
	lastSuccessAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface WebhookDetail extends WebhookSummary {
	filter: Record<string, unknown>;
	/** Chain-trigger filters (chain webhooks only). */
	triggers: ChainTrigger[] | null;
	authConfig: Record<string, unknown>;
	maxRetries: number;
	timeoutMs: number;
	concurrency: number;
	circuitFailures: number;
	circuitOpenedAt: string | null;
	lastError: string | null;
}

export interface CreateWebhookResponse {
	webhook: WebhookDetail;
	/** Plaintext signing secret — surfaced ONCE. Store it server-side. */
	signingSecret: string;
}

export interface RotateSecretResponse {
	webhook: WebhookDetail;
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

/** Result of a one-off test delivery (`POST /:id/test`). Logged as a delivery
 *  row (with a null outbox_id) so it shows up under the webhook's deliveries. */
export interface WebhookTestResult {
	ok: boolean;
	statusCode: number | null;
	error: string | null;
	durationMs: number;
	deliveryId: string;
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

export interface WebhookSchemaColumn {
	type?: unknown;
}

export interface WebhookSchemaTable {
	columns: Record<string, WebhookSchemaColumn>;
}

export type WebhookSchemaTables = Record<string, WebhookSchemaTable>;

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

export function formatWebhookSchemaErrors(error: z.ZodError): string[] {
	return error.issues.map(
		(issue) => `${formatIssuePath(issue.path)}${issue.message}`,
	);
}

function operatorForClause(clause: WebhookFilterClause): string {
	if (clause === null || typeof clause !== "object" || Array.isArray(clause)) {
		return "eq";
	}
	return Object.keys(clause)[0] ?? "eq";
}

export function validateWebhookFilterForTable(input: {
	subgraphName?: string;
	tableName: string;
	filter?: unknown;
	tables: WebhookSchemaTables;
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

	const parsed = WebhookFilterSchema.safeParse(input.filter);
	if (!parsed.success) {
		return formatWebhookSchemaErrors(parsed.error);
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
				`Filter field "${field}" has unsupported type "${columnType || "unknown"}"; webhook filters require scalar columns.`,
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
