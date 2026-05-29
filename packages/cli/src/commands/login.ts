import { confirm, input } from "@inquirer/prompts";
import type { Command } from "commander";
import { CliHttpError, httpPlatform, httpPlatformAnon } from "../lib/http.ts";
import { dim, info, error as logError, success } from "../lib/output.ts";
import { readSession, writeSession } from "../lib/session.ts";

/** ~90 days out — informational only; the server slides the real expiry. */
function sessionExpiry(): string {
	return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
}

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8").trim();
}

/**
 * Non-interactive login: read an API key from stdin, verify it against the
 * account endpoint, and persist it as the stored credential. For CI/headless
 * use, e.g. `echo "$SL_API_KEY" | sl login --with-token`.
 */
async function runTokenLogin(): Promise<void> {
	const token = await readStdin();
	if (!token) {
		logError('No token on stdin. Usage: echo "$KEY" | sl login --with-token');
		process.exit(1);
	}

	// Verify by hitting the account endpoint with the provided key.
	process.env.SL_API_KEY = token;
	let account: { id: string; email: string; plan: string };
	try {
		account = await httpPlatform<{ id: string; email: string; plan: string }>(
			"/api/accounts/me",
		);
	} catch (err) {
		logError(
			err instanceof CliHttpError
				? `Token rejected: ${err.message}`
				: err instanceof Error
					? err.message
					: String(err),
		);
		process.exit(1);
	}

	await writeSession({
		token,
		email: account.email,
		accountId: account.id,
		expiresAt: sessionExpiry(),
	});
	success(`Logged in as ${account.email}`);
}

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

		await writeSession({
			token: verified.sessionToken,
			email: verified.account.email,
			accountId: verified.account.id,
			expiresAt: sessionExpiry(),
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
		.option("--with-token", "Read an API key from stdin (non-interactive)")
		.addHelpText(
			"after",
			`
Examples:
  $ sl login
  $ echo "$SL_API_KEY" | sl login --with-token`,
		)
		.action((opts: { force?: boolean; withToken?: boolean }) =>
			opts.withToken ? runTokenLogin() : runLoginFlow({ force: opts.force }),
		);
}
