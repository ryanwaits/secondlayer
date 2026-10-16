import { z } from "zod";

/**
 * The insight contract. The tenant (`/api/insights`) and platform
 * (`/api/accounts/insights`) routes serve `Insight` verbatim. The web app keeps
 * a field-for-field copy in `apps/web/src/lib/insights.ts`; change both
 * together.
 *
 * The types are written out and the schemas annotated with them, rather than
 * inferred: the bundled `.d.ts` loses inferred zod types (they come out as
 * `unknown`), the same reason `schemas/webhooks.ts` annotates its schemas.
 */

export const INSIGHT_SEVERITIES = [
	"losing",
	"will_fail",
	"costs",
	"recovered",
] as const;

export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export type InsightResourceKind = "webhook" | "subgraph" | "account";

export type InsightEvidence =
	| {
			kind: "series";
			title: string;
			series: {
				name: string;
				role: "a" | "context" | "mark";
				points: number[];
			}[];
			labels: [number, string][];
			unit?: string;
	  }
	| {
			kind: "table";
			title: string;
			columns: string[];
			rows: (string | number)[][];
			markRow?: number;
	  }
	| {
			kind: "shapes";
			title: string;
			shapes: { code: string; body: string; count: number; isNew: boolean }[];
	  }
	| {
			kind: "timeline";
			title: string;
			steps: { what: string; at: string; note?: string; failed: boolean }[];
	  };

export interface Insight {
	id: string;
	rule: string;
	severity: InsightSeverity;
	impact: number;
	resource: {
		kind: InsightResourceKind;
		id: string;
		name: string;
	};
	line: string;
	meta?: string;
	lead: string;
	body: string;
	evidence: InsightEvidence[];
	handoff: { prompt: string; commands: string[] };
	how: {
		detector: string;
		facts: [string, string][];
		label?: { cause: string; confidence: number };
	};
	createdAt: string;
	resolvedAt?: string | null;
}

export interface InsightListResponse {
	data: Insight[];
}

export const InsightSeveritySchema: z.ZodType<InsightSeverity> =
	z.enum(INSIGHT_SEVERITIES);

export const InsightResourceKindSchema: z.ZodType<InsightResourceKind> = z.enum(
	["webhook", "subgraph", "account"],
);

export const InsightEvidenceSchema: z.ZodType<InsightEvidence> =
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("series"),
			title: z.string(),
			series: z.array(
				z.object({
					name: z.string(),
					role: z.enum(["a", "context", "mark"]),
					points: z.array(z.number()),
				}),
			),
			labels: z.array(z.tuple([z.number(), z.string()])),
			unit: z.string().optional(),
		}),
		z.object({
			kind: z.literal("table"),
			title: z.string(),
			columns: z.array(z.string()),
			rows: z.array(z.array(z.union([z.string(), z.number()]))),
			markRow: z.number().optional(),
		}),
		z.object({
			kind: z.literal("shapes"),
			title: z.string(),
			shapes: z.array(
				z.object({
					code: z.string(),
					body: z.string(),
					count: z.number(),
					isNew: z.boolean(),
				}),
			),
		}),
		z.object({
			kind: z.literal("timeline"),
			title: z.string(),
			steps: z.array(
				z.object({
					what: z.string(),
					at: z.string(),
					note: z.string().optional(),
					failed: z.boolean(),
				}),
			),
		}),
	]);

export const InsightSchema: z.ZodType<Insight> = z.object({
	id: z.string(),
	rule: z.string(),
	severity: InsightSeveritySchema,
	impact: z.number(),
	resource: z.object({
		kind: InsightResourceKindSchema,
		id: z.string(),
		name: z.string(),
	}),
	line: z.string(),
	meta: z.string().optional(),
	lead: z.string(),
	body: z.string(),
	evidence: z.array(InsightEvidenceSchema),
	handoff: z.object({
		prompt: z.string(),
		commands: z.array(z.string()),
	}),
	how: z.object({
		detector: z.string(),
		facts: z.array(z.tuple([z.string(), z.string()])),
		label: z.object({ cause: z.string(), confidence: z.number() }).optional(),
	}),
	createdAt: z.string(),
	resolvedAt: z.string().nullable().optional(),
});

export const InsightListResponseSchema: z.ZodType<InsightListResponse> =
	z.object({
		data: z.array(InsightSchema),
	});

export const SEVERITY_ORDER: Record<InsightSeverity, number> = {
	losing: 0,
	will_fail: 1,
	costs: 2,
	recovered: 3,
};
