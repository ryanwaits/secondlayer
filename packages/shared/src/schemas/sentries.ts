import { z } from "zod/v4";

// ── Kind enum (extend as kinds ship) ─────────────────────────────────

export type SentryKind =
	| "large-outflow"
	| "permission-change"
	| "ft-outflow"
	| "contract-deployment"
	| "print-event-match";

export const SentryKindSchema: z.ZodType<SentryKind> = z.enum([
	"large-outflow",
	"permission-change",
	"ft-outflow",
	"contract-deployment",
	"print-event-match",
]);

const PrincipalString = z
	.string()
	.min(28)
	.regex(
		/^S[PMT][0-9A-Z]+(\.[A-Za-z][A-Za-z0-9-]*)?$/,
		"must be a Stacks principal (SP/SM/ST...) optionally .<contract>",
	);

// ── Per-kind config schemas ──────────────────────────────────────────

export interface LargeOutflowConfig {
	principal: string;
	/** Decimal string, not bigint — avoids JSON roundtrip loss. Cast via ::numeric in SQL. */
	thresholdMicroStx: string;
}

export const LargeOutflowConfigSchema: z.ZodType<LargeOutflowConfig> = z.object(
	{
		principal: PrincipalString,
		thresholdMicroStx: z
			.string()
			.regex(/^\d+$/, "must be a non-negative integer as string"),
	},
);

export interface PermissionChangeConfig {
	principal: string;
	adminFunctions: string[];
}

export const PermissionChangeConfigSchema: z.ZodType<PermissionChangeConfig> =
	z.object({
		principal: PrincipalString,
		adminFunctions: z.array(z.string().min(1).max(128)).min(1).max(20),
	});

export interface FtOutflowConfig {
	principal: string;
	/** SIP-010 asset identifier — `SP...CONTRACT.token-name::token-symbol` */
	assetIdentifier: string;
	/** Decimal string — raw (pre-decimal) amount. */
	thresholdAmount: string;
}

export const FtOutflowConfigSchema: z.ZodType<FtOutflowConfig> = z.object({
	principal: PrincipalString,
	assetIdentifier: z.string().min(3).max(256),
	thresholdAmount: z
		.string()
		.regex(/^\d+$/, "must be a non-negative integer as string"),
});

export interface ContractDeploymentConfig {
	principal: string;
}

export const ContractDeploymentConfigSchema: z.ZodType<ContractDeploymentConfig> =
	z.object({
		principal: PrincipalString,
	});

export interface PrintEventMatchConfig {
	principal: string;
	/** Optional topic string — if omitted, every print on the contract matches. */
	topic: string | null;
}

export const PrintEventMatchConfigSchema: z.ZodType<PrintEventMatchConfig> =
	z.object({
		principal: PrincipalString,
		topic: z.string().max(128).nullable(),
	});

/** Get zod schema for a kind's config. */
export function getConfigSchemaForKind(kind: SentryKind): z.ZodTypeAny {
	switch (kind) {
		case "large-outflow":
			return LargeOutflowConfigSchema;
		case "permission-change":
			return PermissionChangeConfigSchema;
		case "ft-outflow":
			return FtOutflowConfigSchema;
		case "contract-deployment":
			return ContractDeploymentConfigSchema;
		case "print-event-match":
			return PrintEventMatchConfigSchema;
		default: {
			const _exhaustive: never = kind;
			throw new Error(`no config schema for kind: ${_exhaustive as string}`);
		}
	}
}

// ── Request bodies ───────────────────────────────────────────────────

export interface CreateSentryRequest {
	kind: SentryKind;
	name: string;
	config: Record<string, unknown>;
	delivery_webhook: string;
	active?: boolean;
}

export const CreateSentryRequestSchema: z.ZodType<CreateSentryRequest> =
	z.object({
		kind: SentryKindSchema,
		name: z.string().min(1).max(120),
		config: z.record(z.string(), z.unknown()),
		delivery_webhook: z.string().url().startsWith("https://"),
		active: z.boolean().optional(),
	});

export interface UpdateSentryRequest {
	name?: string;
	config?: Record<string, unknown>;
	delivery_webhook?: string;
	active?: boolean;
}

export const UpdateSentryRequestSchema: z.ZodType<UpdateSentryRequest> =
	z.object({
		name: z.string().min(1).max(120).optional(),
		config: z.record(z.string(), z.unknown()).optional(),
		delivery_webhook: z.string().url().startsWith("https://").optional(),
		active: z.boolean().optional(),
	});
