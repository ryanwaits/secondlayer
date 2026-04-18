import type { Catalog } from "@json-render/core";
import type { SubgraphFilter } from "@secondlayer/subgraphs/types";
import type { LanguageModel, Tool } from "ai";
import type { ZodType } from "zod/v4";

// --- Triggers ---

export interface EventTrigger {
	type: "event";
	filter: SubgraphFilter;
}

export interface ScheduleTrigger {
	type: "schedule";
	cron: string;
	timezone?: string;
}

export interface ManualInputField {
	type: "string" | "number" | "boolean";
	required?: boolean;
	default?: string | number | boolean;
	description?: string;
}

export interface ManualTrigger {
	type: "manual";
	input?: Record<string, ManualInputField>;
}

export type WorkflowTrigger = EventTrigger | ScheduleTrigger | ManualTrigger;

// --- Retry ---

export interface RetryConfig {
	maxAttempts?: number;
	backoffMs?: number;
	backoffMultiplier?: number;
}

// --- Signers ---

/**
 * Customer-hosted remote signer configuration. Secondlayer never holds the
 * private key — the runner POSTs unsigned transactions to `endpoint` with
 * an HMAC header (resolved at broadcast time via `hmacRef` → secret store),
 * and the customer's service returns the signed transaction.
 *
 * `endpoint` + `publicKey` live in the workflow source (deployed, readable
 * in the dashboard). `hmacRef` references a secret stored separately via
 * `sl secrets set <name> <value>` so rotation does not require redeploy.
 */
export interface RemoteSignerConfig {
	kind: "remote";
	endpoint: string;
	publicKey: string;
	hmacRef: string;
	timeoutMs?: number;
}

export type SignerConfig = RemoteSignerConfig;

// --- AI ---

export interface SchemaField {
	type: "string" | "number" | "boolean" | "array" | "object";
	description?: string;
	items?: string;
}

export interface AIStepOptions {
	prompt: string;
	model?: "haiku" | "sonnet";
	schema?: Record<string, SchemaField>;
}

// --- AI SDK v6 primitives ---

export interface LanguageModelUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface GenerateObjectStepOptions<T> {
	model?: string | LanguageModel;
	schema: ZodType<T>;
	prompt: string;
	system?: string;
}

export interface GenerateObjectStepResult<T> {
	object: T;
	usage: LanguageModelUsage;
}

export interface GenerateTextStepOptions {
	model?: string | LanguageModel;
	prompt: string;
	system?: string;
	tools?: Record<string, Tool>;
	maxSteps?: number;
}

export interface GenerateTextStepResult {
	text: string;
	toolCalls: unknown[];
	steps: unknown[];
	usage: LanguageModelUsage;
}

// --- json-render (catalog-constrained UI output) ---

export interface RenderStepOptions {
	model?: string | LanguageModel;
	prompt: string;
	system?: string;
	context?: Record<string, unknown>;
}

export interface RenderStepResult<T = unknown> {
	spec: T;
	usage: LanguageModelUsage;
}

/**
 * Raw catalog definition — plain-object shape that does NOT require an
 * `@json-render/*` import in the workflow source. The runner wraps this
 * into a real `Catalog` at render time. See `@secondlayer/stacks/ui/schemas`.
 */
export interface RawCatalogDefinition {
	components: Record<string, { props: unknown }>;
	actions?: Record<string, { params?: unknown }>;
}

// --- Delivery ---

export interface WebhookTarget {
	type: "webhook";
	url: string;
	body: Record<string, unknown>;
	headers?: Record<string, string>;
}

export interface SlackTarget {
	type: "slack";
	channel: string;
	text: string;
}

export interface EmailTarget {
	type: "email";
	to: string;
	subject: string;
	body: string;
}

export interface DiscordTarget {
	type: "discord";
	webhookUrl: string;
	content: string;
	username?: string;
	avatarUrl?: string;
}

export interface TelegramTarget {
	type: "telegram";
	botToken: string;
	chatId: string;
	text: string;
	parseMode?: "HTML" | "Markdown";
}

export type DeliverTarget =
	| WebhookTarget
	| SlackTarget
	| EmailTarget
	| DiscordTarget
	| TelegramTarget;

// --- Query ---

export interface QueryOptions {
	where?: Record<string, unknown>;
	orderBy?: Record<string, "asc" | "desc">;
	limit?: number;
	offset?: number;
}

// --- Invoke ---

export interface InvokeOptions {
	workflow: string;
	input?: Record<string, unknown>;
}

// --- MCP ---

export interface McpStepOptions {
	server: string;
	tool: string;
	args?: Record<string, unknown>;
}

export interface McpStepResult {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}

// --- Step Context ---

export interface StepContext {
	run<T>(id: string, fn: () => Promise<T>): Promise<T>;
	ai(id: string, options: AIStepOptions): Promise<Record<string, unknown>>;
	generateObject<T>(
		id: string,
		options: GenerateObjectStepOptions<T>,
	): Promise<GenerateObjectStepResult<T>>;
	generateText(
		id: string,
		options: GenerateTextStepOptions,
	): Promise<GenerateTextStepResult>;
	render<T = unknown>(
		id: string,
		catalog: Catalog | RawCatalogDefinition,
		options: RenderStepOptions,
	): Promise<RenderStepResult<T>>;
	query(
		id: string,
		subgraph: string,
		table: string,
		options?: QueryOptions,
	): Promise<Record<string, unknown>[]>;
	count(
		id: string,
		subgraph: string,
		table: string,
		where?: Record<string, unknown>,
	): Promise<number>;
	deliver(id: string, target: DeliverTarget): Promise<void>;
	sleep(id: string, ms: number): Promise<void>;
	invoke(id: string, options: InvokeOptions): Promise<unknown>;
	mcp(id: string, options: McpStepOptions): Promise<McpStepResult>;
}

// --- Workflow Context ---

export interface WorkflowContext<
	TEvent = Record<string, unknown>,
	TInput = Record<string, unknown> | undefined,
> {
	event: TEvent;
	step: StepContext;
	input?: TInput;
}

// --- Workflow Definition ---

export interface WorkflowDefinition {
	name: string;
	trigger: WorkflowTrigger;
	handler: (ctx: WorkflowContext) => Promise<unknown>;
	retries?: RetryConfig;
	timeout?: number;
	/**
	 * Named signer configurations referenced by `broadcast({ signer: "<name>" })`.
	 * Secondlayer never holds private keys — each signer POSTs to a customer-
	 * hosted endpoint.
	 */
	signers?: Record<string, SignerConfig>;
}

// --- Run types ---

export type WorkflowRunStatus =
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface StepResult {
	id: string;
	status: "completed" | "failed" | "skipped";
	duration: number;
	output?: unknown;
	error?: string;
}

export interface WorkflowRun {
	id: string;
	workflowName: string;
	status: WorkflowRunStatus;
	steps: StepResult[];
	duration: number;
	aiTokensUsed: number;
	triggeredAt: string;
	completedAt: string | null;
}
