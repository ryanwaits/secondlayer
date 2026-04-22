import type { Database } from "@secondlayer/shared/db";
import type { LanguageModel } from "ai";
import type { Kysely } from "kysely";
import type { z } from "zod/v4";

export interface SlackMessage {
	text: string;
	blocks?: Array<Record<string, unknown>>;
}

export interface Triage {
	severity: "low" | "med" | "high";
	summary: string;
	likelyCause: string;
}

export interface DetectContext {
	sourceDb: Kysely<Database>;
	logger: {
		info: (msg: string, meta?: Record<string, unknown>) => void;
		warn: (msg: string, meta?: Record<string, unknown>) => void;
		error: (msg: string, meta?: Record<string, unknown>) => void;
	};
}

export interface TriageContext extends DetectContext {
	ai: LanguageModel;
}

export interface SentryKind<C, M> {
	kind: string;
	configSchema: z.ZodType<C>;
	detect(ctx: DetectContext, config: C, since: Date): Promise<M[]>;
	triage(ctx: TriageContext, config: C, match: M): Promise<Triage>;
	formatAlert(config: C, match: M, triage: Triage): SlackMessage;
	idempotencyKey(match: M): string;
	/** Build a synthetic match for the "Send test alert" button. */
	buildTestMatch(config: C): M;
}
