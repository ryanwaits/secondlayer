import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { computeUsdCost } from "@secondlayer/shared/pricing";
import type { BudgetConfig } from "@secondlayer/workflows";
import type { Kysely } from "kysely";
import { type Period, currentPeriod } from "./period.ts";

/**
 * Per-workflow budget enforcer. The runner constructs one per run via
 * `createEnforcer`, threads it into the step context + broadcast runtime,
 * and calls:
 *
 *   - `enforcer.assertBeforeStep()` — refuses the next step if any counter
 *     is already exhausted
 *   - `enforcer.recordAi({ tokens, provider, modelId })` — after AI steps
 *   - `enforcer.recordBroadcast({ microStx })` — after broadcast steps
 *   - `enforcer.recordStep()` — once per memoize invocation
 *
 * On exceed:
 *   - `pause`  → throw `BudgetExceededError`; processor catches + pauses
 *   - `alert`  → fire `onExceedTarget` (if set), continue
 *   - `silent` → continue, counters still tick for observability
 */

export class BudgetExceededError extends Error {
	readonly name = "BudgetExceededError";
	readonly isRetryable = false;
	constructor(
		message: string,
		readonly counter: BudgetCounter,
		readonly workflowDefinitionId: string,
	) {
		super(message);
	}
}

export type BudgetCounter =
	| "ai_usd"
	| "ai_tokens"
	| "chain_microstx"
	| "chain_tx_count"
	| "run_count"
	| "step_count"
	| "run_duration_ms";

interface EnforcerContext {
	db: Kysely<Database>;
	workflowDefinitionId: string;
	workflow: string;
	runId: string;
	budget: BudgetConfig;
	onAlert?: (entry: {
		counter: BudgetCounter;
		reason: string;
	}) => Promise<void>;
}

export class BudgetEnforcer {
	private readonly period: Period;
	private readonly runStartedAt = Date.now();
	/** Debounce alerts so the same run doesn't spam on every post-step increment. */
	private alertedCounters = new Set<BudgetCounter>();

	constructor(private readonly ctx: EnforcerContext) {
		const reset = ctx.budget.reset ?? "daily";
		this.period = currentPeriod(reset, new Date(), ctx.runId);
	}

	/** Throw or alert if ANY already-exhausted counter would be incremented further. */
	async assertBeforeStep(): Promise<void> {
		const row = await this.loadOrCreate();
		const b = this.ctx.budget;

		const checks: Array<[BudgetCounter, boolean, string]> = [
			[
				"run_duration_ms",
				b.run?.maxDurationMs != null &&
					Date.now() - this.runStartedAt >= b.run.maxDurationMs,
				`run duration ≥ ${b.run?.maxDurationMs}ms`,
			],
			[
				"step_count",
				b.run?.maxSteps != null && row.step_count >= b.run.maxSteps,
				`step count ≥ ${b.run?.maxSteps}`,
			],
			[
				"ai_usd",
				b.ai?.maxUsd != null && Number(row.ai_usd_used) >= b.ai.maxUsd,
				`ai USD ≥ $${b.ai?.maxUsd}`,
			],
			[
				"ai_tokens",
				b.ai?.maxTokens != null &&
					BigInt(row.ai_tokens_used) >= BigInt(b.ai.maxTokens),
				`ai tokens ≥ ${b.ai?.maxTokens}`,
			],
			[
				"chain_microstx",
				b.chain?.maxMicroStx != null &&
					BigInt(row.chain_microstx_used) >= b.chain.maxMicroStx,
				`chain µSTX ≥ ${b.chain?.maxMicroStx}`,
			],
			[
				"chain_tx_count",
				b.chain?.maxTxCount != null && row.chain_tx_count >= b.chain.maxTxCount,
				`chain tx count ≥ ${b.chain?.maxTxCount}`,
			],
		];

		for (const [counter, exceeded, reason] of checks) {
			if (exceeded) await this.onExceed(counter, reason);
		}
	}

	/** Increment AI token + USD counters. Called after AI steps. */
	async recordAi(args: {
		tokens: number;
		provider?: string;
		modelId?: string;
	}): Promise<void> {
		const tokens = Math.max(0, Math.round(args.tokens));
		// Best-effort USD: if provider+modelId known and in pricing table, add.
		const usd =
			args.provider && args.modelId
				? (computeUsdCost(args.provider, args.modelId, {
						inputTokens: Math.floor(tokens / 2),
						outputTokens: Math.ceil(tokens / 2),
					}) ?? 0)
				: 0;

		await this.ctx.db
			.insertInto("workflow_budgets")
			.values({
				workflow_definition_id: this.ctx.workflowDefinitionId,
				period: this.period.key,
				reset_at: this.period.resetAt,
				ai_usd_used: String(usd),
				ai_tokens_used: String(tokens),
			})
			.onConflict((oc) =>
				oc.columns(["workflow_definition_id", "period"]).doUpdateSet({
					ai_usd_used: (eb) =>
						eb("workflow_budgets.ai_usd_used", "+", String(usd)),
					ai_tokens_used: (eb) =>
						eb("workflow_budgets.ai_tokens_used", "+", String(tokens)),
					updated_at: new Date(),
				}),
			)
			.execute();
	}

	/** Increment chain counters. Called from broadcast runtime after submit. */
	async recordBroadcast(args: { microStx: bigint }): Promise<void> {
		await this.ctx.db
			.insertInto("workflow_budgets")
			.values({
				workflow_definition_id: this.ctx.workflowDefinitionId,
				period: this.period.key,
				reset_at: this.period.resetAt,
				chain_microstx_used: args.microStx.toString(),
				chain_tx_count: 1,
			})
			.onConflict((oc) =>
				oc.columns(["workflow_definition_id", "period"]).doUpdateSet({
					chain_microstx_used: (eb) =>
						eb(
							"workflow_budgets.chain_microstx_used",
							"+",
							args.microStx.toString(),
						),
					chain_tx_count: (eb) => eb("workflow_budgets.chain_tx_count", "+", 1),
					updated_at: new Date(),
				}),
			)
			.execute();
	}

	/** Increment step counter. Called once per memoize invocation. */
	async recordStep(): Promise<void> {
		await this.ctx.db
			.insertInto("workflow_budgets")
			.values({
				workflow_definition_id: this.ctx.workflowDefinitionId,
				period: this.period.key,
				reset_at: this.period.resetAt,
				step_count: 1,
			})
			.onConflict((oc) =>
				oc.columns(["workflow_definition_id", "period"]).doUpdateSet({
					step_count: (eb) => eb("workflow_budgets.step_count", "+", 1),
					updated_at: new Date(),
				}),
			)
			.execute();
	}

	private async loadOrCreate() {
		const existing = await this.ctx.db
			.selectFrom("workflow_budgets")
			.selectAll()
			.where("workflow_definition_id", "=", this.ctx.workflowDefinitionId)
			.where("period", "=", this.period.key)
			.executeTakeFirst();
		if (existing) return existing;
		await this.ctx.db
			.insertInto("workflow_budgets")
			.values({
				workflow_definition_id: this.ctx.workflowDefinitionId,
				period: this.period.key,
				reset_at: this.period.resetAt,
			})
			.onConflict((oc) =>
				oc.columns(["workflow_definition_id", "period"]).doNothing(),
			)
			.execute();
		return await this.ctx.db
			.selectFrom("workflow_budgets")
			.selectAll()
			.where("workflow_definition_id", "=", this.ctx.workflowDefinitionId)
			.where("period", "=", this.period.key)
			.executeTakeFirstOrThrow();
	}

	private async onExceed(
		counter: BudgetCounter,
		reason: string,
	): Promise<void> {
		const behavior = this.ctx.budget.onExceed ?? "pause";
		logger.warn("budget exceeded", {
			workflow: this.ctx.workflow,
			counter,
			reason,
			behavior,
		});

		if (behavior === "silent") return;
		if (behavior === "alert") {
			if (!this.alertedCounters.has(counter)) {
				this.alertedCounters.add(counter);
				await this.ctx.onAlert?.({ counter, reason });
			}
			return;
		}
		// pause: mark workflow as paused:budget + throw
		await this.ctx.db
			.updateTable("workflow_definitions")
			.set({ status: "paused:budget" })
			.where("id", "=", this.ctx.workflowDefinitionId)
			.execute();
		await this.ctx.onAlert?.({ counter, reason });
		throw new BudgetExceededError(
			`Workflow "${this.ctx.workflow}" budget exceeded: ${reason}`,
			counter,
			this.ctx.workflowDefinitionId,
		);
	}
}

export function createEnforcer(
	ctx: EnforcerContext,
): BudgetEnforcer | undefined {
	const hasAnyCap =
		ctx.budget.ai?.maxUsd != null ||
		ctx.budget.ai?.maxTokens != null ||
		ctx.budget.chain?.maxMicroStx != null ||
		ctx.budget.chain?.maxTxCount != null ||
		ctx.budget.run?.maxDurationMs != null ||
		ctx.budget.run?.maxSteps != null;
	if (!hasAnyCap) return undefined;
	return new BudgetEnforcer(ctx);
}
