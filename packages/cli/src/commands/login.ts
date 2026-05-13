import { input } from "@inquirer/prompts";
import type { Command } from "commander";
import { CliHttpError, httpPlatform, httpPlatformAnon } from "../lib/http.ts";
import { cyan, dim, info, error as logError, success } from "../lib/output.ts";
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
 * After login, returning users (who already have a tenant) see only the
 * generic `sl whoami` hint — same as before. Fresh accounts (no tenant) get
 * the full four-step walkthrough so they don't have to read docs to find
 * their next command. We deliberately don't auto-provision (Launch is $99/mo;
 * plan choice is the user's call).
 *
 * Network failures fall back to the generic hint — login already succeeded,
 * the nudge is a nice-to-have.
 */
async function printPostLoginHints(): Promise<void> {
	let hasTenant = false;

	try {
		const tenant = await httpPlatform<{ tenant: { apiUrl: string } | null }>(
			"/api/tenants/me",
		);
		hasTenant = Boolean(tenant.tenant?.apiUrl);
	} catch (err) {
		// 404 from `/api/tenants/me` = no tenant yet (expected for fresh
		// accounts) — fall through to the walkthrough. Anything else is real
		// trouble; degrade to the generic hint.
		if (!(err instanceof CliHttpError && err.status === 404)) {
			info(dim("Run 'sl whoami' to see your account status."));
			return;
		}
	}

	if (hasTenant) {
		// Returning user — keep the message minimal.
		info(dim("Run 'sl whoami' to see your account status."));
		return;
	}

	// Fresh account — walk the full sequence so they don't have to hunt.
	console.log();
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
