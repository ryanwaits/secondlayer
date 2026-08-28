import { confirm, input } from "@inquirer/prompts";
import type { Command } from "commander";
import { resolveApiUrl, resolveArchiveOpsUrl } from "../lib/api-url.ts";
import { CliHttpError, httpAt } from "../lib/http.ts";
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

export interface LoginOptions {
	force?: boolean;
	/**
	 * Log in to the archive credits merchant instead of the instance API.
	 * Sessions are stored per URL, so this never touches the instance login.
	 */
	credits?: boolean;
}

/** Which server a login talks to, and the session slot it writes. */
export function loginTarget(opts: LoginOptions): string {
	return opts.credits ? resolveArchiveOpsUrl() : resolveApiUrl();
}

/**
 * Non-interactive login: read an API key from stdin, verify it against the
 * account endpoint, and persist it as the stored credential. For CI/headless
 * use, e.g. `echo "$INSTANCE_TOKEN" | secondlayer login --with-token`.
 */
async function runTokenLogin(opts: LoginOptions): Promise<void> {
	const token = await readStdin();
	if (!token) {
		logError(
			'No token on stdin. Usage: echo "$KEY" | secondlayer login --with-token',
		);
		process.exit(1);
	}

	const target = loginTarget(opts);
	let account: { id: string; email: string };
	try {
		account = await httpAt<{ id: string; email: string }>(
			target,
			"/api/accounts/me",
			{ bearer: token },
		);
	} catch (err) {
		logError(
			err instanceof CliHttpError
				? `Token rejected by ${target}: ${err.message}`
				: err instanceof Error
					? err.message
					: String(err),
		);
		process.exit(1);
	}

	await writeSession(
		{
			token,
			email: account.email,
			accountId: account.id,
			expiresAt: sessionExpiry(),
		},
		target,
	);
	success(`Logged in as ${account.email} (${target})`);
}

/**
 * `secondlayer login` — magic-link email flow.
 *
 * Flow: email → POST /api/auth/magic-link → prompt 6-digit code → POST
 * /api/auth/verify → write session. Server auto-extends session on every
 * subsequent request (sliding window), so no refresh logic here.
 */
export async function runLoginFlow(options: LoginOptions = {}): Promise<void> {
	const target = loginTarget(options);
	if (!options.force) {
		const existing = await readSession(target);
		if (existing) {
			info(`Already logged in as ${existing.email} (${target}).`);
			if (!process.stdin.isTTY) {
				info(
					dim(
						"Run 'secondlayer logout' first, or re-run with --force to switch accounts.",
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
					info(dim("Run 'secondlayer logout' to sign out."));
					return;
				}
			} catch {
				info(
					dim(
						"Run 'secondlayer logout' first, or re-run with --force to switch accounts.",
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
		const res = await httpAt<{
			message: string;
			token?: string;
			code?: string;
		}>(target, "/api/auth/magic-link", {
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
		const verified = await httpAt<{
			sessionToken: string;
			account: { id: string; email: string };
		}>(target, "/api/auth/verify", {
			method: "POST",
			body: { email, code },
		});

		await writeSession(
			{
				token: verified.sessionToken,
				email: verified.account.email,
				accountId: verified.account.id,
				expiresAt: sessionExpiry(),
			},
			target,
		);
		success(`Logged in as ${verified.account.email}`);
		info(
			dim(
				options.credits
					? "Run 'secondlayer credits balance' to see your archive credits."
					: "Run 'secondlayer whoami' to see your account status.",
			),
		);
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
		.command("login", { hidden: true })
		.description("Log in to Secondlayer (magic-link email)")
		.option("--force", "Skip the already-logged-in check and re-run the flow")
		.option("--with-token", "Read an API key from stdin (non-interactive)")
		.option(
			"--credits",
			"Log in to the archive credits account used by bootstrap, repair, and credits",
		)
		.addHelpText(
			"after",
			`
Examples:
  $ secondlayer login --credits
  $ echo "$INSTANCE_TOKEN" | secondlayer login --with-token`,
		)
		.action(
			(opts: { force?: boolean; withToken?: boolean; credits?: boolean }) =>
				opts.withToken
					? runTokenLogin({ credits: opts.credits })
					: runLoginFlow({ force: opts.force, credits: opts.credits }),
		);
}
