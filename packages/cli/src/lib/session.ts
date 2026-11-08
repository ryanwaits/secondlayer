import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { isHostedApiUrl } from "@secondlayer/sdk";
import { z } from "zod";
import {
	ARCHIVE_OPS_API_URL,
	resolveApiUrl,
	resolveArchiveOpsUrl,
} from "./api-url.ts";
import { secondlayerDir } from "./home.ts";

/**
 * CLI session storage.
 *
 * The CLI's persisted credential: a browser-login session token (ss-sl_…),
 * or the account key `login --with-token` was given. Written to
 * `~/.secondlayer/session.json` with 0600 perms, keyed by URL. Every command
 * reads and writes the one slot for your hosted account URL, so a login
 * against one server is never sent to another. Instance tokens are never
 * stored here.
 *
 * Auto-refresh: the server-side auth middleware (packages/api/src/auth/middleware.ts)
 * already runs a sliding-window 90-day expiry extension on every authed
 * request. The CLI just uses the stored token; the server keeps it fresh.
 */

const SessionSchema = z.object({
	token: z.string().min(1),
	// Null for an account with no email on file (a key minted before sign-up).
	email: z.string().email().nullable(),
	accountId: z.string().uuid(),
	expiresAt: z.string(), // ISO 8601
});

export type Session = z.infer<typeof SessionSchema>;

/** How a login is named in a message: its email, else the account id (an
 *  account minted before sign-up has no email). */
export function accountLabel(email: string | null, accountId: string): string {
	return email ?? accountId;
}

type SessionFile = { sessions: Record<string, Session> };

/** `session.json` in the CLI state directory (see `secondlayerDir`). */
export function getSessionPath(): string {
	return join(secondlayerDir(), "session.json");
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
 * sessions rather than crashing; the user is prompted to log in. Each slot is
 * checked on its own: one bad entry loses that login, never the others.
 */
function parseSessionFile(raw: string): SessionFile {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { sessions: {} };
	}
	const slots = (parsed as { sessions?: unknown } | null)?.sessions;
	if (slots && typeof slots === "object" && !Array.isArray(slots)) {
		const sessions: Record<string, Session> = {};
		for (const [url, slot] of Object.entries(slots)) {
			const valid = SessionSchema.safeParse(slot);
			if (valid.success) sessions[url] = valid.data;
		}
		return { sessions };
	}
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

/**
 * Read the login for `apiUrl` (default: your hosted account, the one slot
 * `login`, `logout`, `keys` and every authed command share).
 *
 * Older CLIs wrote under the API URL and read under the account URL, so an
 * account-URL read that finds nothing adopts a login filed under another
 * hosted URL (the default host, or the API URL) and rewrites it under the one
 * key. The old entry stays put; nothing is deleted. Only hosted hosts are
 * adopted, so an instance login is never promoted to the account slot.
 */
export async function readSession(
	apiUrl: string = resolveArchiveOpsUrl(),
	path: string = getSessionPath(),
): Promise<Session | null> {
	const file = await readSessionFile(path);
	const key = sessionKey(apiUrl);
	const found = file.sessions[key];
	if (found) return found;
	if (key !== sessionKey(resolveArchiveOpsUrl()) || !isHostedApiUrl(key)) {
		return null;
	}
	const legacy = [ARCHIVE_OPS_API_URL, resolveApiUrl()]
		.map(sessionKey)
		.filter((candidate) => candidate !== key && isHostedApiUrl(candidate))
		.map((candidate) => file.sessions[candidate])
		.find((session) => session !== undefined);
	if (!legacy) return null;
	try {
		await writeSessionFile(
			{ sessions: { ...file.sessions, [key]: legacy } },
			path,
		);
	} catch {
		// Adopting is best effort; the login still works for this call.
	}
	return legacy;
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
	apiUrl: string = resolveArchiveOpsUrl(),
	path: string = getSessionPath(),
): Promise<void> {
	// Parsed here so a session that would not read back is never written: one
	// bad write used to make the whole file unreadable.
	const valid = SessionSchema.parse(session);
	const file = await readSessionFile(path);
	file.sessions[sessionKey(apiUrl)] = valid;
	await writeSessionFile(file, path);
}

export async function clearSession(
	apiUrl: string = resolveArchiveOpsUrl(),
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
