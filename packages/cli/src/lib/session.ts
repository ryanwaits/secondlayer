import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod/v4";

/**
 * CLI session storage.
 *
 * The session token (ss-sl_…) is the CLI's only persisted credential. It's
 * written to `~/.secondlayer/session.json` with 0600 perms. No service keys
 * ever land on disk — they're minted ephemerally per-command via the
 * platform API's mint-ephemeral endpoint.
 *
 * Auto-refresh: the server-side auth middleware (packages/api/src/auth/middleware.ts)
 * already runs a sliding-window 90-day expiry extension on every authed
 * request. The CLI just uses the stored token; the server keeps it fresh.
 */

const SessionSchema = z.object({
	token: z.string().min(1),
	email: z.string().email(),
	accountId: z.string().uuid(),
	expiresAt: z.string(), // ISO 8601
});

export type Session = z.infer<typeof SessionSchema>;

const SESSION_DIR = join(homedir(), ".secondlayer");
const SESSION_PATH = join(SESSION_DIR, "session.json");

export function getSessionPath(): string {
	return SESSION_PATH;
}

export async function readSession(): Promise<Session | null> {
	try {
		const raw = await readFile(SESSION_PATH, "utf8");
		return SessionSchema.parse(JSON.parse(raw));
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
		// Malformed session file is treated as "no session" rather than
		// crashing; user is prompted to log in.
		return null;
	}
}

export async function writeSession(session: Session): Promise<void> {
	await mkdir(dirname(SESSION_PATH), { recursive: true });
	await writeFile(
		SESSION_PATH,
		JSON.stringify(session, null, 2) + "\n",
		"utf8",
	);
	await chmod(SESSION_PATH, 0o600);
}

export async function clearSession(): Promise<void> {
	await rm(SESSION_PATH, { force: true });
}
