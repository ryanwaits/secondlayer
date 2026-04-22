import { z } from "zod/v4";

// ── Kind enum (extend as kinds ship) ─────────────────────────────────

export type SentryKind = "large-outflow" | "permission-change";

export const SentryKindSchema: z.ZodType<SentryKind> = z.enum([
	"large-outflow",
	"permission-change",
]);

// ── Per-kind config schemas ──────────────────────────────────────────

export interface LargeOutflowConfig {
	principal: string;
	/** Decimal string, not bigint — avoids JSON roundtrip loss. Cast via ::numeric in SQL. */
	thresholdMicroStx: string;
}

export const LargeOutflowConfigSchema: z.ZodType<LargeOutflowConfig> = z.object(
	{
		principal: z
			.string()
			.min(28)
			.regex(
				/^S[PMT][0-9A-Z]+(\.[A-Za-z][A-Za-z0-9-]*)?$/,
				"must be a Stacks principal (SP/SM/ST...) optionally .<contract>",
			),
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
		principal: z
			.string()
			.min(28)
			.regex(
				/^S[PMT][0-9A-Z]+(\.[A-Za-z][A-Za-z0-9-]*)?$/,
				"must be a Stacks principal (SP/SM/ST...) optionally .<contract>",
			),
		adminFunctions: z.array(z.string().min(1).max(128)).min(1).max(20),
	});

/** Get zod schema for a kind's config. */
export function getConfigSchemaForKind(kind: SentryKind): z.ZodTypeAny {
	switch (kind) {
		case "large-outflow":
			return LargeOutflowConfigSchema;
		case "permission-change":
			return PermissionChangeConfigSchema;
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
