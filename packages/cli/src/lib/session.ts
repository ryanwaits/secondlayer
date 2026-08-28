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
import { ARCHIVE_OPS_API_URL, resolveApiUrl } from "./api-url.ts";

/**
 * CLI session storage.
 *
 * Session tokens (ss-sl_…) are the CLI's only persisted credential. They're
 * written to `~/.secondlayer/session.json` with 0600 perms, one per API URL:
 * the loopback instance and the archive credits merchant are different
 * servers with different accounts, so a login against one never gets sent
 * to the other. No service keys ever land on disk.
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

const SessionFileSchema = z.object({
	sessions: z.record(z.string(), SessionSchema),
});

type SessionFile = z.infer<typeof SessionFileSchema>;

/**
 * Resolved per call, honoring `HOME` explicitly: Bun's `os.homedir()` reads
 * the passwd entry rather than the env, so a test (or an operator running
 * under `HOME=/srv/sl`) would otherwise land on the login user's file.
 */
export function getSessionPath(): string {
	return join(process.env.HOME || homedir(), ".secondlayer", "session.json");
}

/** Sessions are keyed by origin plus path, trailing slashes dropped. */
export function sessionKey(apiUrl: string): string {
	return apiUrl.replace(/\/+$/, "");
}

/**
 * Parse the file. The pre-scoped shape was one flat session written by a
 * login against the hosted API, the only server it could have come from, so
 * it is upgraded in memory under that constant URL (not the env override,
 * which would file it under whatever SL_CREDITS_API_URL happened to be set);
 * the next write persists the scoped shape. Anything else reads as no
 * sessions rather than crashing; the user is prompted to log in.
 */
function parseSessionFile(raw: string): SessionFile {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { sessions: {} };
	}
	const scoped = SessionFileSchema.safeParse(parsed);
	if (scoped.success) return scoped.data;
	const flat = SessionSchema.safeParse(parsed);
	if (flat.success) {
		return { sessions: { [sessionKey(ARCHIVE_OPS_API_URL)]: flat.data } };
	}
	return { sessions: {} };
}

async function readSessionFile(path: string): Promise<SessionFile> {
	try {
		return parseSessionFile(await readFile(path, "utf8"));
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
			return { sessions: {} };
		}
		return { sessions: {} };
	}
}

export async function readSession(
	apiUrl: string = resolveApiUrl(),
	path: string = getSessionPath(),
): Promise<Session | null> {
	const file = await readSessionFile(path);
	return file.sessions[sessionKey(apiUrl)] ?? null;
}

async function writeSessionFile(
	file: SessionFile,
	path: string,
): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true });
	const tmp = join(dir, `.session.${process.pid}.tmp`);
	await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, {
		mode: 0o600,
		encoding: "utf8",
	});
	// Belt-and-suspenders: enforce 0600 even if the temp file's create-time
	// mode was affected by an unusual umask. rename() then carries this
	// mode onto the destination atomically, so there is no world-readable window.
	await chmod(tmp, 0o600);
	await rename(tmp, path);
}

// `path` override exists only so tests can point writeSession at a temp
// file. Callers in this package never pass it.
//
// Both mutators are read-modify-write with no lock. Two logins racing on
// different slots can drop one another's write; the rename is atomic so the
// file is never torn, and re-running the login repairs it. Fine for a CLI a
// person drives by hand; add a lock if scripted parallel logins ever bite.
export async function writeSession(
	session: Session,
	apiUrl: string = resolveApiUrl(),
	path: string = getSessionPath(),
): Promise<void> {
	const file = await readSessionFile(path);
	file.sessions[sessionKey(apiUrl)] = session;
	await writeSessionFile(file, path);
}

export async function clearSession(
	apiUrl: string = resolveApiUrl(),
	path: string = getSessionPath(),
): Promise<void> {
	const file = await readSessionFile(path);
	delete file.sessions[sessionKey(apiUrl)];
	if (Object.keys(file.sessions).length === 0) {
		await rm(path, { force: true });
		return;
	}
	await writeSessionFile(file, path);
}
