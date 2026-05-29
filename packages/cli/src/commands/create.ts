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
import { blue, error, info, success, warn } from "../lib/output.ts";
import { resolveAuth } from "../lib/resolve-auth.ts";
import { validateSubscriptionTargetFromApi } from "../lib/subscription-validation.ts";
import { deriveBaseUrl } from "../utils/urls.ts";

/**
 * `sl subscriptions create <name> --runtime <runtime>`
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
	skipApi?: boolean;
	// commander's `--no-scaffold` declares an inverse boolean: opts.scaffold is
	// true by default and becomes false when --no-scaffold is passed.
	scaffold?: boolean;
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
	// Validate runtime BEFORE touching the filesystem. The template-dir lookup
	// at copyTemplate() would otherwise throw `template dir missing` after
	// mkdirSync had already created the target — leaving litter on disk.
	if (opts.runtime && !RUNTIMES.includes(opts.runtime)) {
		error(`Unknown --runtime "${opts.runtime}". Valid: ${RUNTIMES.join(", ")}`);
		process.exit(1);
	}
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
			sl = await getSubscriptionClient();
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
	if (!opts.scaffold === false) {
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
	}

	// Provision the subscription via SDK unless --skip-api was passed (useful
	// for offline template scaffolding while the user sets up auth first).
	let signingSecret: string | null = null;
	let provisioningFailed = false;
	if (!opts.skipApi) {
		try {
			if (!sl) sl = await getSubscriptionClient();
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

	// Write the signing secret to .env (creates if missing — all 4 templates
	// now ship .env.example; even if a template doesn't, we still write).
	let subscriptionId: string | undefined;
	let subscriptionStatus: string | undefined;
	if (sl) {
		try {
			const list = await sl.subscriptions.list();
			const rows =
				(list as { data?: Array<{ name: string; id: string; status: string }> })
					.data ?? [];
			const created = rows.find((s) => s.name === name);
			subscriptionId = created?.id;
			subscriptionStatus = created?.status;
		} catch {
			// best-effort; don't block on read-back
		}
	}
	if (signingSecret && !opts.scaffold === false) {
		const envTarget = join(targetDir, ".env");
		const envExample = join(targetDir, ".env.example");
		if (existsSync(envExample) && !existsSync(envTarget)) {
			copyFileSync(envExample, envTarget);
		}
		if (!existsSync(envTarget)) {
			writeFileSync(envTarget, `SIGNING_SECRET=${signingSecret}\n`);
		} else {
			const cur = readFileSync(envTarget, "utf8");
			writeFileSync(
				envTarget,
				cur.match(/^SIGNING_SECRET=/m)
					? cur.replace(
							/^SIGNING_SECRET=.*/m,
							`SIGNING_SECRET=${signingSecret}`,
						)
					: `${cur}\nSIGNING_SECRET=${signingSecret}\n`,
			);
		}
		success(`Signing secret written to ${relative(process.cwd(), envTarget)}`);
	} else if (signingSecret && opts.scaffold === false) {
		// No scaffold dir to write to — surface the secret so the user can store it.
		info(`Signing secret (store securely): ${signingSecret}`);
	}

	console.log();
	if (provisioningFailed) {
		error("Subscription was not created.");
		process.exit(1);
	}

	// Success footer — dashboard URL, resume hint if paused, run instructions.
	let dashboardLine = "";
	try {
		const { apiUrl } = await resolveAuth();
		const base = deriveBaseUrl(apiUrl);
		dashboardLine = subscriptionId
			? `Dashboard: ${base}/platform/subgraphs/${subgraph}/subscriptions/${subscriptionId}\n  `
			: `Dashboard: ${base}/platform/subgraphs/${subgraph}/subscriptions\n  `;
	} catch {
		// dashboard URL is decorative; don't block on it
	}
	const pausedLine =
		subscriptionStatus === "paused"
			? `Subscription is paused. Resume:\n  sl subscriptions resume ${name}\n  `
			: "";
	const runHint =
		opts.scaffold === false
			? `View deliveries:\n  sl subscriptions get ${name}`
			: `cd ${name}\n  bun install\n  bun run dev`;
	success(`Done. Next:\n  ${dashboardLine}${pausedLine}${runHint}`);
}

export async function getSubscriptionClient(): Promise<SecondLayer> {
	const { apiUrl, ephemeralKey } = await resolveAuth();
	return new SecondLayer({ baseUrl: apiUrl, apiKey: ephemeralKey });
}

/**
 * Register the subscription-receiver scaffolder onto `parent` under
 * `commandSpec`. Shared so it can mount as both `subscriptions create` (canonical)
 * and the deprecated `create subscription`.
 */
function addSubscriptionScaffold(
	parent: Command,
	commandSpec: string,
	opts: { description: string; examplePrefix: string },
): void {
	parent
		.command(commandSpec)
		.description(opts.description)
		.option("-r, --runtime <runtime>", "inngest | trigger | cloudflare | node")
		.option("-s, --subgraph <name>", "Subgraph to subscribe to")
		.option("-t, --table <name>", "Table to subscribe to")
		.option("-u, --url <url>", "Webhook URL")
		.option("--auth-token <token>", "Bearer token for receiver API auth")
		.option(
			"--filter <kv...>",
			"Filter as key=value (supports .eq/.neq/.gt/.gte/.lt/.lte suffixes)",
		)
		.option("--skip-api", "Copy template only, don't call the API")
		.option(
			"--no-scaffold",
			"Skip the local runtime template directory (webhook-only setups)",
		)
		.addHelpText(
			"after",
			`
Examples:
  $ ${opts.examplePrefix} my-sub -s my-graph -t transfers -u https://example.com/webhook
  $ ${opts.examplePrefix} my-sub -s my-graph -t balances -r inngest --filter amount.gte=1000`,
		)
		.action(async (name: string, options: CreateSubscriptionOptions) => {
			await createSubscription(name, options);
		});
}

/** Canonical home: `sl subscriptions create <name>`. */
export function addSubscriptionsCreateCommand(subscriptions: Command): void {
	addSubscriptionScaffold(subscriptions, "create <name>", {
		description: "Create a subscription receiver for a runtime",
		examplePrefix: "sl subscriptions create",
	});
}
