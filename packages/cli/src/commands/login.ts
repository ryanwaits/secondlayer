import { hostname } from "node:os";
import { createInterface } from "node:readline";
import { confirm, input } from "@inquirer/prompts";
import type { Command } from "commander";
import { resolveArchiveOpsUrl } from "../lib/api-url.ts";
import { CliHttpError, httpAt } from "../lib/http.ts";
import { openBrowser } from "../lib/open-browser.ts";
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
}

/**
 * The server a login talks to and the session slot it writes: always your
 * hosted Secondlayer account. A self-host instance has no accounts (it uses
 * `INSTANCE_TOKEN`), so there is nothing to sign in to there.
 */
export function loginTarget(): string {
	return resolveArchiveOpsUrl();
}

/**
 * Non-interactive login: read an API key from stdin, verify it against the
 * account endpoint, and persist it as the stored credential. For CI/headless
 * use, e.g. `echo "$SECONDLAYER_API_KEY" | secondlayer login --with-token`.
 */
async function runTokenLogin(): Promise<void> {
	const token = await readStdin();
	if (!token) {
		logError(
			'No token on stdin. Usage: echo "$KEY" | secondlayer login --with-token',
		);
		process.exit(1);
	}

	const target = loginTarget();
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

export interface LoginCheckDeps {
	readSession: typeof readSession;
	/** Resolves if the server accepts the token; throws CliHttpError when it doesn't. */
	verify: (target: string, token: string) => Promise<unknown>;
}

const defaultLoginCheckDeps: LoginCheckDeps = {
	readSession,
	verify: (target, token) =>
		httpAt(target, "/api/accounts/me", { bearer: token }),
};

/**
 * The "already logged in" check shared by both flows. False means stop: the
 * caller has already said why.
 */
export async function shouldContinueLogin(
	target: string,
	options: LoginOptions,
	deps: LoginCheckDeps = defaultLoginCheckDeps,
): Promise<boolean> {
	if (options.force) return true;
	const existing = await deps.readSession(target);
	if (!existing) return true;
	try {
		await deps.verify(target, existing.token);
	} catch (err) {
		if (
			err instanceof CliHttpError &&
			(err.status === 401 || err.status === 403)
		) {
			info(
				`Your saved login for ${existing.email} stopped working (revoked or expired). Signing in again.`,
			);
			return true;
		}
		// Offline or a server error: we can't tell, so keep the saved login.
	}
	info(`Already logged in as ${existing.email} (${target}).`);
	const hint =
		"Run 'secondlayer logout' first, or re-run with --force to switch accounts.";
	if (!process.stdin.isTTY) {
		info(dim(hint));
		return false;
	}
	try {
		const proceed = await confirm({
			message: "Log in as a different user?",
			default: false,
		});
		if (!proceed) {
			info(dim("Run 'secondlayer logout' to sign out."));
			return false;
		}
	} catch {
		info(dim(hint));
		return false;
	}
	return true;
}

interface DeviceStart {
	deviceCode: string;
	userCode: string;
	verificationUrl: string;
	interval: number;
	expiresIn: number;
}

export type DeviceOutcome =
	| {
			kind: "approved";
			sessionToken: string;
			account: { id: string; email: string };
	  }
	| { kind: "denied" }
	| { kind: "expired" };

interface PollDeps {
	post: <T>(path: string, body: unknown) => Promise<T>;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
}

/**
 * Poll the token endpoint until the browser answers. 428 = still waiting,
 * 403 = cancelled in the browser, 410 = the code is gone. A flaky network
 * retries a few times before giving up.
 */
export async function pollDeviceToken(
	start: Pick<DeviceStart, "deviceCode" | "interval" | "expiresIn">,
	deps: PollDeps,
): Promise<DeviceOutcome> {
	const deadline = deps.now() + start.expiresIn * 1000;
	let failures = 0;
	while (deps.now() < deadline) {
		await deps.sleep(start.interval * 1000);
		try {
			const res = await deps.post<{
				sessionToken: string;
				account: { id: string; email: string };
			}>("/api/cli/device/token", { deviceCode: start.deviceCode });
			return {
				kind: "approved",
				sessionToken: res.sessionToken,
				account: res.account,
			};
		} catch (err) {
			if (err instanceof CliHttpError) {
				if (err.status === 428) {
					failures = 0;
					continue;
				}
				if (err.status === 403 && err.body.error === "access_denied") {
					return { kind: "denied" };
				}
				if (err.status === 410) return { kind: "expired" };
				throw err;
			}
			if (++failures >= 3) throw err;
		}
	}
	return { kind: "expired" };
}

/** Machine name shown on the approval page. */
function clientName(): string {
	return hostname().trim().slice(0, 64) || "this machine";
}

/**
 * `secondlayer login` — browser flow, like `gh auth login`. Shows a short code,
 * opens the browser, and polls until the user approves it there. The server
 * opens a session (like `--email`), which `logout` revokes. API keys stay for
 * reading data; signing in never makes one.
 */
export async function runDeviceLogin(
	options: LoginOptions = {},
): Promise<void> {
	const target = loginTarget();
	if (!(await shouldContinueLogin(target, options))) return;

	let start: DeviceStart;
	try {
		start = await httpAt<DeviceStart>(target, "/api/cli/device", {
			method: "POST",
			body: { clientName: clientName() },
		});
	} catch (err) {
		logError(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}

	info(`First copy your one-time code: ${start.userCode}`);
	const readline = process.stdin.isTTY
		? createInterface({ input: process.stdin })
		: null;
	if (readline) {
		info("Press Enter to open secondlayer.tools in your browser...");
		readline.once("line", () => openBrowser(start.verificationUrl));
	}
	info(dim(`Or open ${start.verificationUrl}`));
	info(dim("Waiting for you to approve in the browser..."));

	let outcome: DeviceOutcome;
	try {
		outcome = await pollDeviceToken(start, {
			post: (path, body) => httpAt(target, path, { method: "POST", body }),
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
			now: Date.now,
		});
	} catch (err) {
		readline?.close();
		logError(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
	readline?.close();

	if (outcome.kind === "denied") {
		logError("Cancelled in the browser.");
		process.exit(1);
	}
	if (outcome.kind === "expired") {
		logError("The code expired. Run secondlayer login again.");
		process.exit(1);
	}

	await writeSession(
		{
			token: outcome.sessionToken,
			email: outcome.account.email,
			accountId: outcome.account.id,
			expiresAt: sessionExpiry(),
		},
		target,
	);
	success(`Logged in as ${outcome.account.email} on ${clientName()}`);
	info(dim("Run 'secondlayer logout' to sign this machine out."));
}

/**
 * `secondlayer login --email` — magic-link email flow, for machines with no
 * browser at hand.
 *
 * Flow: email → POST /api/auth/magic-link → prompt 6-digit code → POST
 * /api/auth/verify → write session. Server auto-extends session on every
 * subsequent request (sliding window), so no refresh logic here.
 */
export async function runLoginFlow(options: LoginOptions = {}): Promise<void> {
	const target = loginTarget();
	if (!(await shouldContinueLogin(target, options))) return;

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
		info(dim("Run 'secondlayer whoami' to see your account status."));
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
		.description("Log in to Secondlayer through your browser")
		.option("--force", "Skip the already-logged-in check and re-run the flow")
		.option(
			"--email",
			"Sign in with an emailed 6-digit code instead of a browser",
		)
		.option("--with-token", "Read an API key from stdin (non-interactive)")
		.addHelpText(
			"after",
			`
Examples:
  $ secondlayer login
  $ secondlayer login --email
  $ echo "$SECONDLAYER_API_KEY" | secondlayer login --with-token`,
		)
		.action(
			(opts: { force?: boolean; email?: boolean; withToken?: boolean }) =>
				opts.withToken
					? runTokenLogin()
					: opts.email
						? runLoginFlow({ force: opts.force })
						: runDeviceLogin({ force: opts.force }),
		);
}
