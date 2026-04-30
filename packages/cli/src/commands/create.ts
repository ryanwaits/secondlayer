import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { input, select } from "@inquirer/prompts";
import { SecondLayer } from "@secondlayer/sdk";
import type { CreateSubscriptionRequest } from "@secondlayer/sdk";
import type { Command } from "commander";
import { parseSubscriptionFilter } from "../lib/filter-params.ts";
import { blue, dim, error, info, success, warn } from "../lib/output.ts";
import { resolveActiveTenant } from "../lib/resolve-tenant.ts";
import { validateSubscriptionTargetFromApi } from "../lib/subscription-validation.ts";

/**
 * `sl create subscription <name> --runtime <runtime>`
 *
 * Copies a runtime template into `./{name}/`, string-replaces the template
 * variables, and provisions the subscription via the SDK so the emitter
 * starts pushing events to the dev server the moment the user boots it.
 */

type Runtime = "inngest" | "trigger" | "cloudflare" | "node";

const RUNTIMES: Runtime[] = ["inngest", "trigger", "cloudflare", "node"];

const FORMAT_BY_RUNTIME: Record<Runtime, string> = {
	inngest: "inngest",
	trigger: "trigger",
	cloudflare: "cloudflare",
	node: "standard-webhooks",
};

function templatesRoot(): string {
	// `src/commands/create.ts` → runtime path depends on build:
	//   - Bundle: `dist/index.js` → package root is one level up
	//   - Source (bun run): `src/commands/create.ts` → package root is two up
	const here = dirname(fileURLToPath(import.meta.url));
	const candidateDist = resolve(here, "..", "templates", "subscriptions");
	if (existsSync(candidateDist)) return candidateDist;
	return resolve(here, "..", "..", "templates", "subscriptions");
}

function copyTemplate(
	src: string,
	dest: string,
	vars: Record<string, string>,
): void {
	if (!existsSync(src)) {
		throw new Error(`template dir missing: ${src}`);
	}
	mkdirSync(dest, { recursive: true });
	const entries = readdirSync(src);
	for (const entry of entries) {
		const from = join(src, entry);
		const to = join(dest, entry);
		const st = statSync(from);
		if (st.isDirectory()) {
			copyTemplate(from, to, vars);
		} else {
			const raw = readFileSync(from, "utf8");
			const rendered = raw.replace(
				/\{\{([A-Z_]+)\}\}/g,
				(match, key) => vars[key] ?? match,
			);
			writeFileSync(to, rendered);
		}
	}
}

export interface CreateSubscriptionOptions {
	runtime?: Runtime;
	subgraph?: string;
	table?: string;
	url?: string;
	authToken?: string;
	serviceKey?: string;
	baseUrl?: string;
	skipApi?: boolean;
	filter?: string[];
}

async function promptFor(
	_name: string,
	opts: CreateSubscriptionOptions,
): Promise<{
	runtime: Runtime;
	subgraph: string;
	table: string;
	url: string;
}> {
	const runtime =
		opts.runtime ??
		((await select({
			message: "Runtime?",
			choices: RUNTIMES.map((r) => ({ name: r, value: r })),
		})) as Runtime);

	const subgraph =
		opts.subgraph ??
		(await input({
			message: "Subgraph name (must already be deployed):",
			validate: (v) => (v.trim().length > 0 ? true : "required"),
		}));

	const table =
		opts.table ??
		(await input({
			message: "Table to subscribe to:",
			validate: (v) => (v.trim().length > 0 ? true : "required"),
		}));

	const url =
		opts.url ??
		(await input({
			message:
				runtime === "inngest"
					? "Inngest event endpoint URL (e.g. https://inn.gs/e/<KEY> or http://localhost:8288/e/<KEY>):"
					: runtime === "trigger"
						? "Trigger.dev task URL (e.g. https://api.trigger.dev/api/v1/tasks/<TASK_ID>/trigger):"
						: runtime === "cloudflare"
							? "Cloudflare Workflows instances URL:"
							: "Your HTTP receiver URL (e.g. https://yourapp.example/webhook):",
			validate: (v) =>
				v.startsWith("http://") || v.startsWith("https://")
					? true
					: "must be http(s) URL",
		}));

	return { runtime, subgraph, table, url };
}

export function buildSubscriptionAuthConfig(
	authToken?: string,
): Record<string, unknown> | undefined {
	if (authToken === undefined) return undefined;
	const token = authToken.trim();
	if (token.length === 0) {
		throw new Error("--auth-token must not be empty");
	}
	return { authType: "bearer", token };
}

export async function createSubscription(
	name: string,
	opts: CreateSubscriptionOptions,
): Promise<void> {
	const { runtime, subgraph, table, url } = await promptFor(name, opts);
	let filter: Record<string, unknown> | undefined;
	let authConfig: Record<string, unknown> | undefined;
	try {
		filter = parseSubscriptionFilter(opts.filter);
		authConfig = buildSubscriptionAuthConfig(opts.authToken);
	} catch (err) {
		error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}

	let sl: SecondLayer | null = null;
	if (!opts.skipApi) {
		try {
			sl = await getSubscriptionClient(opts);
			await validateSubscriptionTargetFromApi(sl, {
				subgraphName: subgraph,
				tableName: table,
				filter,
			});
		} catch (err) {
			error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		}
	}

	const eventName = `${subgraph}.${table}.created`;
	const targetDir = resolve(process.cwd(), name);
	if (existsSync(targetDir)) {
		error(`Directory already exists: ${relative(process.cwd(), targetDir)}`);
		process.exit(1);
	}

	const tplRoot = templatesRoot();
	const tplDir = join(tplRoot, runtime);
	info(`Scaffolding ${blue(runtime)} template at ${blue(targetDir)}`);
	copyTemplate(tplDir, targetDir, {
		NAME: name,
		EVENT_NAME: eventName,
		TASK_ID: `${subgraph}-${table}`,
	});

	// Provision the subscription via SDK unless --skip-api was passed (useful
	// for offline template scaffolding while the user sets up auth first).
	let signingSecret: string | null = null;
	let provisioningFailed = false;
	if (!opts.skipApi) {
		try {
			if (!sl) sl = await getSubscriptionClient(opts);
			const res = await sl.subscriptions.create({
				name,
				subgraphName: subgraph,
				tableName: table,
				url,
				format: FORMAT_BY_RUNTIME[runtime] as
					| "inngest"
					| "trigger"
					| "cloudflare"
					| "standard-webhooks",
				runtime,
				...(filter ? { filter } : {}),
				...(authConfig ? { authConfig } : {}),
			} as CreateSubscriptionRequest);
			signingSecret = res.signingSecret;
			success(`Subscription provisioned: ${blue(res.subscription.id)}`);
		} catch (err) {
			provisioningFailed = true;
			warn(
				`Subscription provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			info(
				"Template copied, but the subscription was not created. Provision it in the dashboard, or remove the template directory and rerun this command after fixing the API error.",
			);
		}
	}

	// Write the signing secret into the scaffolded .env.local if present.
	if (signingSecret) {
		const envTarget = join(targetDir, ".env");
		const envExample = join(targetDir, ".env.example");
		if (existsSync(envExample) && !existsSync(envTarget)) {
			copyFileSync(envExample, envTarget);
		}
		if (existsSync(envTarget)) {
			const cur = readFileSync(envTarget, "utf8");
			const next = cur.replace(
				/^SIGNING_SECRET=.*/m,
				`SIGNING_SECRET=${signingSecret}`,
			);
			writeFileSync(
				envTarget,
				next.includes("SIGNING_SECRET=")
					? next
					: `${cur}\nSIGNING_SECRET=${signingSecret}\n`,
			);
			success(
				`Signing secret written to ${relative(process.cwd(), envTarget)}`,
			);
		} else {
			info(
				`Signing secret (copy this — won't be shown again):\n${dim("  ")}${signingSecret}`,
			);
		}
	}

	console.log();
	if (provisioningFailed) {
		error("Subscription was not created.");
		process.exit(1);
	}
	success(`Done. Next:\n  cd ${name}\n  bun install\n  bun run dev`);
}

export type SubscriptionClientOptions = Pick<
	CreateSubscriptionOptions,
	"baseUrl" | "serviceKey"
>;

type SubscriptionClientEnv = {
	[key: string]: string | undefined;
	SL_API_URL?: string;
	SL_SERVICE_KEY?: string;
};

type ResolvedTenantCredentials = Awaited<
	ReturnType<typeof resolveActiveTenant>
>;

type SubscriptionClientConfig =
	| { needsTenantResolution: true }
	| { needsTenantResolution: false; baseUrl: string; apiKey: string };

export function resolveSubscriptionClientConfig(
	opts: SubscriptionClientOptions,
	env: SubscriptionClientEnv = process.env,
	resolved?: ResolvedTenantCredentials,
): SubscriptionClientConfig {
	const needsResolvedKey = !opts.serviceKey && !env.SL_SERVICE_KEY;
	const needsResolvedUrl = !opts.baseUrl && !env.SL_API_URL;
	if ((needsResolvedKey || needsResolvedUrl) && !resolved) {
		return { needsTenantResolution: true };
	}

	const apiKey =
		opts.serviceKey ?? env.SL_SERVICE_KEY ?? resolved?.ephemeralKey;
	const baseUrl = opts.baseUrl ?? env.SL_API_URL ?? resolved?.apiUrl;

	if (!apiKey) {
		throw new Error(
			"No service key available. Run `sl login` from an active project or pass --service-key.",
		);
	}
	if (!baseUrl) {
		throw new Error(
			"No tenant API URL available. Run `sl project use <slug>` or pass --base-url.",
		);
	}

	return { needsTenantResolution: false, baseUrl, apiKey };
}

export async function getSubscriptionClient(
	opts: SubscriptionClientOptions,
): Promise<SecondLayer> {
	const config = resolveSubscriptionClientConfig(opts);
	if (!config.needsTenantResolution) {
		return new SecondLayer({ baseUrl: config.baseUrl, apiKey: config.apiKey });
	}

	const resolved = await resolveActiveTenant();
	const resolvedConfig = resolveSubscriptionClientConfig(
		opts,
		process.env,
		resolved,
	);
	if (resolvedConfig.needsTenantResolution) {
		throw new Error("Could not resolve active tenant credentials.");
	}

	return new SecondLayer({
		baseUrl: resolvedConfig.baseUrl,
		apiKey: resolvedConfig.apiKey,
	});
}

export function registerCreateCommand(program: Command): void {
	const create = program
		.command("create")
		.description("Scaffold new resources (subscription receivers, etc.)");

	create
		.command("subscription <name>")
		.description("Scaffold a subscription receiver for a runtime")
		.option("-r, --runtime <runtime>", "inngest | trigger | cloudflare | node")
		.option("-s, --subgraph <name>", "Subgraph to subscribe to")
		.option("-t, --table <name>", "Table to subscribe to")
		.option("-u, --url <url>", "Webhook URL")
		.option("--auth-token <token>", "Bearer token for receiver API auth")
		.option(
			"--filter <kv...>",
			"Filter as key=value (supports .eq/.neq/.gt/.gte/.lt/.lte suffixes)",
		)
		.option("--service-key <key>", "SL_SERVICE_KEY override")
		.option("--base-url <url>", "SL_API_URL override")
		.option("--skip-api", "Copy template only, don't call the API")
		.action(async (name: string, options: CreateSubscriptionOptions) => {
			await createSubscription(name, options);
		});
}
