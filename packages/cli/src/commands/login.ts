import { confirm, input } from "@inquirer/prompts";
import type { Command } from "commander";
import { CliHttpError, httpPlatformAnon } from "../lib/http.ts";
import { dim, info, error as logError, success } from "../lib/output.ts";
import { readSession, writeSession } from "../lib/session.ts";

/**
 * `sl login` — magic-link email flow.
 *
 * Flow: email → POST /api/auth/magic-link → prompt 6-digit code → POST
 * /api/auth/verify → write session. Server auto-extends session on every
 * subsequent request (sliding window), so no refresh logic here.
 */
export async function runLoginFlow(
	options: { force?: boolean } = {},
): Promise<void> {
	if (!options.force) {
		const existing = await readSession();
		if (existing) {
			info(`Already logged in as ${existing.email}.`);
			if (!process.stdin.isTTY) {
				info(
					dim(
						"Run 'sl logout' first, or re-run with --force to switch accounts.",
					),
				);
				return;
			}
			try {
				const proceed = await confirm({
					message: "Log in as a different user?",
					default: false,
				});
				if (!proceed) {
					info(dim("Run 'sl logout' to sign out."));
					return;
				}
			} catch {
				info(
					dim(
						"Run 'sl logout' first, or re-run with --force to switch accounts.",
					),
				);
				return;
			}
		}
	}

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
		info(dim("Run 'sl whoami' to see your account status."));
	} catch (err) {
		if (err instanceof CliHttpError) {
			logError(err.message);
		} else {
			logError(err instanceof Error ? err.message : String(err));
		}
		process.exit(1);
	}
}

export function registerLoginCommand(program: Command): void {
	program
		.command("login")
		.description("Log in to Secondlayer (magic-link email)")
		.option(
			"-f, --force",
			"Skip the already-logged-in check and re-run the flow",
		)
		.action((opts: { force?: boolean }) => runLoginFlow({ force: opts.force }));
}
