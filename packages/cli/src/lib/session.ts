import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

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

// `path` override exists only so tests can point writeSession at a temp
// file without racing the module-level SESSION_PATH constant (which is
// resolved once from homedir() at import time). Callers in this package
// never pass it.
export async function writeSession(
	session: Session,
	path: string = SESSION_PATH,
): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true });
	const tmp = join(dir, `.session.${process.pid}.tmp`);
	await writeFile(tmp, `${JSON.stringify(session, null, 2)}\n`, {
		mode: 0o600,
		encoding: "utf8",
	});
	// Belt-and-suspenders: enforce 0600 even if the temp file's create-time
	// mode was affected by an unusual umask. rename() then carries this
	// mode onto the destination atomically — no world-readable window.
	await chmod(tmp, 0o600);
	await rename(tmp, path);
}

export async function clearSession(): Promise<void> {
	await rm(SESSION_PATH, { force: true });
}
