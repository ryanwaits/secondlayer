import { confirm, input, select } from "@inquirer/prompts";
import type { Command } from "commander";
import { loadConfig } from "../lib/config.ts";
import { CliHttpError, httpPlatform } from "../lib/http.ts";
import {
	blue,
	dim,
	formatKeyValue,
	green,
	info,
	error as logError,
	success,
	warn,
} from "../lib/output.ts";
import { readActiveProject } from "../lib/project-file.ts";
import { isOssMode } from "../lib/resolve-tenant.ts";

type Plan = "hobby" | "launch" | "grow" | "scale" | "enterprise";
const INSTANCE_CREATE_TIMEOUT_MS = 180_000;

interface TenantSummary {
	slug: string;
	plan: Plan;
	status: string;
	apiUrl: string;
	createdAt: string;
	cpus?: number;
	memoryMb?: number;
	storageLimitMb?: number;
}

/**
 * `sl instance` — dedicated-hosting tenant lifecycle.
 *
 * All subcommands scope to the active project (per-dir `.secondlayer/project`
 * with `~/.secondlayer/config.json:defaultProject` fallback). Creating
 * requires an active project (1:1 project→tenant rule).
 *
 * OSS mode (`SL_API_URL` set but no session) blocks every subcommand —
 * instance lifecycle only makes sense for hosted deployments.
 */
export function registerInstanceCommand(program: Command): void {
	const instance = program
		.command("instance")
		.description("Manage your dedicated Secondlayer instance");

	instance
		.command("create")
		.description("Provision a new dedicated instance for the active project")
		.option(
			"--plan <plan>",
			"Plan: hobby (free) | launch | grow | scale",
			"hobby",
		)
		.action(async (opts: { plan: string }) => {
			guardOssMode();
			const activeSlug = await requireActiveProject();
			const plan = opts.plan as Plan;
			if (!["hobby", "launch", "grow", "scale"].includes(plan)) {
				logError(
					`Invalid plan: ${plan} (expected hobby, launch, grow, or scale)`,
				);
				process.exit(1);
			}

			const spinner = createSpinner(
				"Provisioning your instance (~60s; safe to interrupt — instance will still be created; check `sl instance info`)",
			);
			try {
				const res = await httpPlatform<{
					tenant: TenantSummary;
					credentials: { apiUrl: string; anonKey: string; serviceKey: string };
				}>(`/api/projects/${encodeURIComponent(activeSlug)}/instance`, {
					method: "POST",
					body: { plan },
					timeoutMs: INSTANCE_CREATE_TIMEOUT_MS,
				});
				spinner.succeed(`Instance provisioned: ${res.tenant.slug}`);
				printKeyReveal(res.tenant, res.credentials);
			} catch (err) {
				if (isTimeoutError(err)) {
					spinner.fail("Provision request timed out after 3 minutes.");
					logError(
						"Provisioning may still finish server-side. Run `sl instance info` to check before retrying.",
					);
					process.exit(1);
				}
				spinner.fail("Provision failed.");
				handleInstanceError(err, "provision instance");
			}
		});

	instance
		.command("info")
		.description("Show the active project's instance")
		.action(async () => {
			guardOssMode();
			await renderInstanceInfo();
		});

	instance
		.command("resize")
		.description("Change your instance plan (brief downtime)")
		.option("--plan <plan>", "Target plan: hobby | launch | grow | scale")
		.option("--yes", "Skip confirm")
		.action(async (opts: { plan?: string; yes?: boolean }) => {
			guardOssMode();
			let target = opts.plan as Plan | undefined;
			if (!target) {
				const answer = await select({
					message: "Target plan",
					choices: [
						{
							value: "hobby",
							name: "Hobby — free (0.5 vCPU · 512 MB · 5 GB, auto-pause after 7d idle)",
						},
						{
							value: "launch",
							name: "Launch — $99/mo (1 vCPU · 2 GB · 10 GB)",
						},
						{ value: "grow", name: "Grow — $249/mo (2 vCPU · 4 GB · 50 GB)" },
						{
							value: "scale",
							name: "Scale — $599/mo (4 vCPU · 8 GB · 200 GB)",
						},
					],
				});
				target = answer as Plan;
			}

			if (!opts.yes) {
				const ok = await confirm({
					message: `Resize to ${target}? ~30s downtime while containers recreate. Data preserved.`,
					default: false,
				});
				if (!ok) {
					info("Cancelled.");
					return;
				}
			}

			try {
				await httpPlatform("/api/tenants/me/resize", {
					method: "POST",
					body: { plan: target },
				});
				success(`Resized to ${target}.`);
			} catch (err) {
				handleInstanceError(err, "resize");
			}
		});

	instance
		.command("suspend")
		.description("Stop your instance (data preserved)")
		.action(async () => {
			guardOssMode();
			try {
				await httpPlatform("/api/tenants/me/suspend", { method: "POST" });
				success("Instance suspended.");
			} catch (err) {
				handleInstanceError(err, "suspend");
			}
		});

	instance
		.command("resume")
		.description("Start a suspended instance")
		.action(async () => {
			guardOssMode();
			try {
				await httpPlatform("/api/tenants/me/resume", { method: "POST" });
				success("Instance resumed.");
			} catch (err) {
				handleInstanceError(err, "resume");
			}
		});

	instance
		.command("delete")
		.description("Permanently delete your instance + all data")
		.option("--yes", "Skip typed-slug confirm")
		.action(async (opts: { yes?: boolean }) => {
			guardOssMode();
			const info_ = await httpPlatform<{
				tenant: TenantSummary | null;
			}>("/api/tenants/me").catch(() => null);
			if (!info_?.tenant) {
				warn("No instance to delete.");
				return;
			}
			const slug = info_.tenant.slug;

			if (!opts.yes) {
				const typed = await input({
					message: `Type the slug "${slug}" to confirm permanent deletion`,
					validate: (v: string) =>
						v === slug ? true : "Slug must match exactly",
				});
				if (typed !== slug) return;
			}

			try {
				await httpPlatform("/api/tenants/me", { method: "DELETE" });
				success("Instance deleted.");
			} catch (err) {
				handleInstanceError(err, "delete");
			}
		});

	const keys = instance
		.command("keys")
		.description("Rotate long-lived keys (service, anon)");
	keys
		.command("rotate")
		.description("Rotate one or both keys")
		.option("--service", "Rotate the service key")
		.option("--anon", "Rotate the anon key")
		.option("--both", "Rotate both keys (nuclear)")
		.action(
			async (opts: { service?: boolean; anon?: boolean; both?: boolean }) => {
				guardOssMode();
				let type: "service" | "anon" | "both";
				if (opts.both || (opts.service && opts.anon)) type = "both";
				else if (opts.service) type = "service";
				else if (opts.anon) type = "anon";
				else {
					const answer = await select({
						message: "Which key(s) to rotate?",
						choices: [
							{
								value: "service",
								name: "Service key (full access, server-side)",
							},
							{ value: "anon", name: "Anon key (read-only, client-safe)" },
							{
								value: "both",
								name: "Both (nuclear — offboarding/leak response)",
							},
						],
					});
					type = answer as "service" | "anon" | "both";
				}

				try {
					const res = await httpPlatform<{
						type: string;
						rotated: { serviceKey?: string; anonKey?: string };
						serviceGen: number;
						anonGen: number;
					}>("/api/tenants/me/keys/rotate", {
						method: "POST",
						body: { type },
					});
					success(`${type === "both" ? "Keys" : `${type} key`} rotated.`);
					const rows: [string, string][] = [];
					if (res.rotated.serviceKey)
						rows.push(["New service key", res.rotated.serviceKey]);
					if (res.rotated.anonKey)
						rows.push(["New anon key", res.rotated.anonKey]);
					console.log("");
					console.log(
						warn_box(
							"⚠  Shown once. Save these now — we can't retrieve them later.",
						),
					);
					console.log("");
					console.log(formatKeyValue(rows));
					console.log("");
				} catch (err) {
					handleInstanceError(err, "rotate keys");
				}
			},
		);

	const db = instance
		.command("db")
		.description(
			"Get a DATABASE_URL for direct Postgres access (via SSH tunnel)",
		);

	db.command("info", { isDefault: true })
		.description("Print SSH tunnel command + DATABASE_URL for the instance")
		.action(async () => {
			guardOssMode();
			try {
				const res = await httpPlatform<{
					slug: string;
					bastionHost: string;
					bastionPort: number;
					bastionUser: string;
					pgContainer: string;
					localPort: number;
					sshCommand: string;
					databaseUrl: string;
				}>("/api/tenants/me/db-access");
				console.log("");
				console.log(dim("1. Upload your public key (one time):"));
				console.log(dim("   sl instance db add-key ~/.ssh/id_ed25519.pub"));
				console.log("");
				console.log(dim("2. Open the SSH tunnel in a separate terminal:"));
				console.log(green(`   ${res.sshCommand}`));
				console.log("");
				console.log(dim("3. Use this DATABASE_URL while the tunnel is open:"));
				console.log(green(`   ${res.databaseUrl}`));
				console.log("");
			} catch (err) {
				handleInstanceError(err, "fetch db access info");
			}
		});

	db.command("add-key <path>")
		.description("Upload an SSH public key to the bastion for this instance")
		.action(async (path: string) => {
			guardOssMode();
			let publicKey: string;
			try {
				publicKey = (await Bun.file(path).text()).trim();
			} catch (err) {
				logError(
					`Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`,
				);
				process.exit(1);
			}
			if (!publicKey) {
				logError(`${path} is empty`);
				process.exit(1);
			}
			try {
				await httpPlatform<{ slug: string; user: string }>(
					"/api/tenants/me/db-access/key",
					{ method: "POST", body: { publicKey } },
				);
				success("Bastion key installed. You can now open the SSH tunnel.");
			} catch (err) {
				handleInstanceError(err, "upload bastion key");
			}
		});

	db.command("revoke-key")
		.description("Revoke bastion access for this instance")
		.option("-y, --yes", "Skip confirmation")
		.action(async (opts: { yes?: boolean }) => {
			guardOssMode();
			if (!opts.yes) {
				const ok = await confirm({
					message: "Revoke bastion access for this instance?",
					default: false,
				});
				if (!ok) return;
			}
			try {
				await httpPlatform<{ slug: string; removed: boolean }>(
					"/api/tenants/me/db-access/key",
					{ method: "DELETE" },
				);
				success("Bastion access revoked.");
			} catch (err) {
				handleInstanceError(err, "revoke bastion key");
			}
		});
}

// ── helpers ───────────────────────────────────────────────────────────

function guardOssMode(): void {
	if (isOssMode()) {
		logError(
			"`sl instance` commands are for hosted deployments. For OSS use `sl local` / `sl stack` or your own provisioning.",
		);
		process.exit(1);
	}
}

async function requireActiveProject(): Promise<string> {
	const config = await loadConfig();
	const active = await readActiveProject(process.cwd(), config.defaultProject);
	if (!active) {
		logError(
			"No active project — run `sl project create <name>` or `sl project use <slug>` first.",
		);
		process.exit(1);
	}
	return active.slug;
}

async function renderInstanceInfo(): Promise<void> {
	try {
		const res = await httpPlatform<{ tenant: TenantSummary | null }>(
			"/api/tenants/me",
		);
		if (!res.tenant) {
			info(
				"No instance for the active project. Run `sl instance create --plan launch`.",
			);
			return;
		}
		const t = res.tenant;
		console.log(
			formatKeyValue([
				["URL", t.apiUrl],
				["Plan", t.plan],
				["Status", t.status],
				["Created", new Date(t.createdAt).toLocaleString()],
			]),
		);
	} catch (err) {
		handleInstanceError(err, "fetch instance");
	}
}

function printKeyReveal(
	tenant: TenantSummary,
	creds: { apiUrl: string; anonKey: string; serviceKey: string },
): void {
	console.log("");
	console.log(blue("━".repeat(60)));
	console.log(blue("  Save your keys — shown once. Can't retrieve later."));
	console.log(blue("━".repeat(60)));
	console.log("");
	console.log(
		formatKeyValue([
			["URL", creds.apiUrl],
			["Plan", tenant.plan],
			["Service key", green(creds.serviceKey)],
			["Anon key", green(creds.anonKey)],
		]),
	);
	console.log("");
	console.log(
		dim("Run `sl subgraphs deploy <file>` to deploy your first subgraph."),
	);
	console.log("");
}

function createSpinner(message: string): {
	succeed: (message: string) => void;
	fail: (message: string) => void;
} {
	if (!process.stderr.isTTY) {
		info(message);
		return {
			succeed: success,
			fail: logError,
		};
	}

	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let index = 0;
	const render = () => {
		const frame = frames[index % frames.length] ?? frames[0];
		index += 1;
		process.stderr.write(`\r${blue(frame)} ${message}`);
	};
	const clear = () => {
		clearInterval(timer);
		process.stderr.write("\r\x1b[2K");
	};
	const timer = setInterval(render, 80);
	render();

	return {
		succeed(message: string) {
			clear();
			success(message);
		},
		fail(message: string) {
			clear();
			logError(message);
		},
	};
}

function isTimeoutError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return (
		err.name === "TimeoutError" ||
		err.name === "AbortError" ||
		err.message.toLowerCase().includes("timeout")
	);
}

function warn_box(message: string): string {
	return `${"━".repeat(message.length + 4)}\n  ${message}  \n${"━".repeat(message.length + 4)}`;
}

function handleInstanceError(err: unknown, action: string): never {
	if (err instanceof CliHttpError) {
		if (err.code === "SESSION_EXPIRED") {
			logError("Session expired. Run: sl login");
			process.exit(1);
		}
		if (err.code === "TENANT_SUSPENDED") {
			logError("Instance is suspended. Run: sl instance resume");
			process.exit(1);
		}
		if (err.code === "INSTANCE_EXISTS") {
			logError(
				"This project already has an instance. Run `sl instance info` to see it.",
			);
			process.exit(1);
		}
		logError(err.message);
		process.exit(1);
	}
	logError(
		`Failed to ${action}: ${err instanceof Error ? err.message : String(err)}`,
	);
	process.exit(1);
}
