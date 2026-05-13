import { input } from "@inquirer/prompts";
import type { Command } from "commander";
import { loadConfig } from "../lib/config.ts";
import { CliHttpError, httpPlatform, httpPlatformAnon } from "../lib/http.ts";
import { cyan, dim, info, error as logError, success } from "../lib/output.ts";
import { readActiveProject } from "../lib/project-file.ts";
import { writeSession } from "../lib/session.ts";

/**
 * `sl login` — magic-link email flow.
 *
 * Flow: email → POST /api/auth/magic-link → prompt 6-digit code → POST
 * /api/auth/verify → write session. Server auto-extends session on every
 * subsequent request (sliding window), so no refresh logic here.
 */
export async function runLoginFlow(): Promise<void> {
	const email = await input({
		message: "Email",
		validate: (v: string) => (/^.+@.+\..+$/.test(v) ? true : "Invalid email"),
	});

	try {
		const res = await httpPlatformAnon<{
			message: string;
			token?: string;
			code?: string;
		}>("/api/auth/magic-link", {
			method: "POST",
			body: { email },
		});
		info("Check your inbox for a 6-digit code.");
		if (res.code) {
			info(dim(`(DEV_MODE code: ${res.code})`));
		}
	} catch (err) {
		if (err instanceof CliHttpError) {
			logError(err.message);
		} else {
			logError(err instanceof Error ? err.message : String(err));
		}
		process.exit(1);
	}

	const code = await input({
		message: "Enter the 6-digit code",
		validate: (v: string) => (/^\d{6}$/.test(v) ? true : "Expected 6 digits"),
	});

	try {
		const verified = await httpPlatformAnon<{
			sessionToken: string;
			account: { id: string; email: string; plan: string };
		}>("/api/auth/verify", {
			method: "POST",
			body: { email, code },
		});

		// Server does sliding-window extension; 90d from now is informational.
		const expiresAt = new Date(
			Date.now() + 90 * 24 * 60 * 60 * 1000,
		).toISOString();

		await writeSession({
			token: verified.sessionToken,
			email: verified.account.email,
			accountId: verified.account.id,
			expiresAt,
		});
		success(`Logged in as ${verified.account.email}`);

		// Print tailored next-step block based on provisioning state. Returning
		// users with a fully set-up account see only the success line; first-time
		// users see the exact commands to get to a working deploy. We DON'T
		// auto-provision (costs real money + plan choice is the user's call) but
		// we don't make them go read docs either.
		await printPostLoginHints();
	} catch (err) {
		if (err instanceof CliHttpError) {
			logError(err.message);
		} else {
			logError(err instanceof Error ? err.message : String(err));
		}
		process.exit(1);
	}
}

/**
 * Inspect post-login state (active project in cwd, tenant on account) and
 * print the appropriate next-step block. Best-effort — any network failure
 * silently degrades to the generic `sl whoami` hint.
 *
 * Four states:
 *   1. Has project bound + instance running → show the deploy command.
 *   2. Has instance but no project bound in cwd → suggest `sl project use`.
 *   3. Has project but no instance → suggest `sl instance create`.
 *   4. Fresh account, neither → walk the full sequence.
 */
async function printPostLoginHints(): Promise<void> {
	let activeSlug: string | null = null;
	let hasTenant = false;

	try {
		const config = await loadConfig();
		const active = await readActiveProject(
			process.cwd(),
			config.defaultProject,
		);
		activeSlug = active?.slug ?? null;
	} catch {
		// loadConfig / readActiveProject failures shouldn't block login UX.
	}

	try {
		const tenant = await httpPlatform<{ tenant: { apiUrl: string } | null }>(
			"/api/tenants/me",
		);
		hasTenant = Boolean(tenant.tenant?.apiUrl);
	} catch (err) {
		// 404 from `/api/tenants/me` is the EXPECTED state for a fresh account
		// (no tenant has been provisioned yet) — fall through so the State-4
		// walkthrough fires. Any other error (5xx, network) is real; degrade to
		// the generic hint.
		if (err instanceof CliHttpError && err.status === 404) {
			hasTenant = false;
		} else {
			info(dim("Run 'sl whoami' to see your account status."));
			return;
		}
	}

	console.log();
	if (hasTenant && activeSlug) {
		// State 1 — fully set up. Skip nudges; advanced user just relogged.
		info(
			dim(
				`Active project: ${activeSlug}. Try ${cyan("sl subgraphs new --template basic")}`,
			),
		);
		return;
	}

	if (hasTenant && !activeSlug) {
		// State 2 — has instance but not bound in this dir.
		info("Your account has an instance. Bind a project to this directory:");
		console.log(
			dim("    ") +
				cyan("sl project use <slug>") +
				dim("        # list options with `sl project list`"),
		);
		return;
	}

	if (!hasTenant && activeSlug) {
		// State 3 — has a project but no instance.
		info(
			`Project "${activeSlug}" is bound. Provision an instance to start indexing:`,
		);
		console.log(
			dim("    ") +
				cyan("sl instance create --plan launch") +
				dim("   # $99/mo, 2 vCPU / 6GB"),
		);
		return;
	}

	// State 4 — fresh account. Walk the full sequence.
	info("First time? Here's the path to your first query:");
	console.log();
	console.log(dim("  1. ") + cyan("sl project create my-app"));
	console.log(
		dim("     ") + dim("# scopes your data and routing — pick any name"),
	);
	console.log();
	console.log(dim("  2. ") + cyan("sl instance create --plan launch"));
	console.log(
		dim("     ") +
			dim("# $99/mo · 2 vCPU / 6GB · run `sl --help` for other plans"),
	);
	console.log();
	console.log(
		dim("  3. ") +
			cyan("sl subgraphs new my-watcher --template sip-010-balances"),
	);
	console.log(dim("     ") + dim("# five templates ship with the CLI"));
	console.log();
	console.log(
		dim("  4. ") + cyan("sl subgraphs deploy subgraphs/my-watcher.ts"),
	);
	console.log(dim("     ") + dim("# six seconds, backfill auto-starts"));
	console.log();
	info(dim("Run `sl whoami` at any time to see where you are in the flow."));
}

export function registerLoginCommand(program: Command): void {
	program
		.command("login")
		.description("Log in to Secondlayer (magic-link email)")
		.action(runLoginFlow);
}
