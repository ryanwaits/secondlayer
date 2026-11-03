import { resolveAccountKey } from "@secondlayer/sdk";
import type { Command } from "commander";
import { httpArchiveOps, resolveArchiveOpsUrl } from "../lib/http.ts";
import {
	blue,
	confirmDestructive,
	formatTable,
	info,
	error as logError,
	note,
	output,
	success,
	warn,
	writeData,
} from "../lib/output.ts";
import { type Session, readSession, writeSession } from "../lib/session.ts";

/** One row of `GET /api/keys`. */
export interface ListedKey {
	id: string;
	prefix: string;
	name: string | null;
	status: string;
	product: string;
	tier: string | null;
	createdAt: string;
	lastUsedAt: string | null;
	expiresAt: string | null;
	rowsDaily: number[];
	rows30d: number;
}

/** The `201` body of `POST /api/keys/{id}/rotate`. */
export interface RotatedKey {
	key: string;
	prefix: string;
	id: string;
	name: string | null;
	product: string;
	tier: string | null;
	createdAt: string;
	rotatedFrom: string;
}

const MIN_ID_REF_LENGTH = 8;

/** Only active account keys can be rotated. */
export function rotatableKeys(keys: ListedKey[]): ListedKey[] {
	return keys.filter((k) => k.status === "active" && k.product === "account");
}

function describeKey(key: ListedKey): string {
	return `${key.id.slice(0, 8)} ${key.name ?? "(unnamed)"}`;
}

/** Match by id (full, or 8+ leading characters), then prefix, then name. */
export function resolveKeyRef(keys: ListedKey[], ref: string): ListedKey {
	const candidates = rotatableKeys(keys);
	const barePrefix = ref.replace(/…$/, "");
	const kinds: ((k: ListedKey) => boolean)[] = [
		(k) =>
			k.id === ref || (ref.length >= MIN_ID_REF_LENGTH && k.id.startsWith(ref)),
		(k) => k.prefix === barePrefix,
		(k) => k.name === ref,
	];
	for (const matches of kinds) {
		const found = candidates.filter(matches);
		if (found.length === 1) return found[0] as ListedKey;
		if (found.length > 1) {
			throw new Error(
				`"${ref}" matches ${found.length} keys: ${found.map(describeKey).join(", ")}. Use an id.`,
			);
		}
	}
	throw new Error(
		`No active account key matches "${ref}". Run: secondlayer keys list`,
	);
}

export interface RotationDeps {
	apiUrl: string;
	readSession: (apiUrl: string) => Promise<Session | null>;
	writeSession: (session: Session, apiUrl: string) => Promise<void>;
	envKey: string | undefined;
}

/**
 * A key stored by `login --with-token` is the key that was just rotated away:
 * swap in the new one. Browser-login tokens (`ss-sl_`) are unaffected. An env
 * key can't be edited from here, so report it as stale.
 */
export async function applyRotationToLogin(
	prefix: string,
	newKey: string,
	deps: Partial<RotationDeps> = {},
): Promise<{ loginUpdated: boolean; envStale: boolean }> {
	const apiUrl = deps.apiUrl ?? resolveArchiveOpsUrl();
	const read = deps.readSession ?? readSession;
	const write = deps.writeSession ?? writeSession;
	const envKey = "envKey" in deps ? deps.envKey : resolveAccountKey();
	if (!prefix) return { loginUpdated: false, envStale: false };

	let loginUpdated = false;
	const session = await read(apiUrl);
	if (session?.token.startsWith(prefix)) {
		await write({ ...session, token: newKey }, apiUrl);
		loginUpdated = true;
	}
	return { loginUpdated, envStale: envKey?.startsWith(prefix) ?? false };
}

/**
 * `applyRotationToLogin` that cannot throw. By the time it runs the old key is
 * already revoked, so a failed login write (disk full, permissions) must not
 * stop the new key from printing: the error comes back for a warning instead.
 */
export async function saveRotatedLogin(
	prefix: string,
	newKey: string,
	deps: Partial<RotationDeps> = {},
): Promise<{ loginUpdated: boolean; envStale: boolean; loginError?: string }> {
	try {
		return await applyRotationToLogin(prefix, newKey, deps);
	} catch (err) {
		const envKey = "envKey" in deps ? deps.envKey : resolveAccountKey();
		return {
			loginUpdated: false,
			envStale: Boolean(prefix) && (envKey?.startsWith(prefix) ?? false),
			loginError: err instanceof Error ? err.message : String(err),
		};
	}
}

function fail(err: unknown): never {
	if (err instanceof Error) {
		logError(err.message);
		process.exit(1);
	}
	throw err;
}

async function fetchKeys(): Promise<ListedKey[]> {
	const res = await httpArchiveOps<{ keys: ListedKey[] }>("/api/keys");
	return res.keys;
}

async function runList(opts: { json?: boolean }): Promise<void> {
	let keys: ListedKey[];
	try {
		keys = rotatableKeys(await fetchKeys());
	} catch (err) {
		fail(err);
	}
	output({
		json: opts.json,
		data: {
			keys: keys.map(({ rowsDaily: _rowsDaily, ...rest }) => rest),
		},
		human: () => {
			if (keys.length === 0) {
				note(
					"No active account keys. Make one at https://www.secondlayer.tools/account/keys",
				);
				return;
			}
			console.log(
				formatTable(
					["ID", "NAME", "KEY", "LAST READ", "ROWS 30D"],
					keys.map((k) => [
						k.id.slice(0, 8),
						k.name ?? "(unnamed)",
						`${k.prefix}…`,
						k.lastUsedAt ?? "never",
						k.rows30d.toLocaleString("en-US"),
					]),
				),
			);
		},
	});
}

async function runRotate(
	ref: string,
	opts: { yes?: boolean; json?: boolean },
): Promise<void> {
	let target: ListedKey;
	try {
		target = resolveKeyRef(await fetchKeys(), ref);
	} catch (err) {
		fail(err);
	}
	const label = target.name ?? "(unnamed)";
	const ok = await confirmDestructive({
		message: `Rotate "${label}" (${target.prefix}…)? Anything using it gets a 401 at once.`,
		yes: opts.yes,
	});
	if (!ok) {
		info("Cancelled");
		return;
	}

	let rotated: RotatedKey;
	try {
		rotated = await httpArchiveOps<RotatedKey>(
			`/api/keys/${target.id}/rotate`,
			{ method: "POST", body: {} },
		);
	} catch (err) {
		fail(err);
	}

	// The old key is already revoked, so a login update that fails must never
	// stop the new key from printing below: saveRotatedLogin reports instead.
	const { loginUpdated, envStale, loginError } = await saveRotatedLogin(
		target.prefix,
		rotated.key,
	);

	if (opts.json) {
		writeData(JSON.stringify({ ...rotated, loginUpdated }, null, 2));
	} else {
		success(`Rotated ${blue(label)}. The old key has stopped working.`);
		writeData(rotated.key);
		note("Shown once. Copy it now.");
	}
	if (loginError) {
		warn(
			`Couldn't update your CLI login: ${loginError}. Run: secondlayer login --with-token`,
		);
	}
	if (loginUpdated) info("Updated your CLI login to the new key.");
	if (envStale) warn("SECONDLAYER_API_KEY still holds the old key. Update it.");
}

export function registerKeysCommand(program: Command): void {
	const keys = program.command("keys").description("Manage account keys");

	keys
		.command("list")
		.alias("ls")
		.description("List your active account keys")
		.option("--json", "Output as JSON")
		.action((opts: { json?: boolean }) => runList(opts));

	keys
		.command("rotate <ref>")
		.description("Replace a key's secret; the old one stops working at once")
		.option("-y, --yes", "Skip confirmation")
		.option("--json", "Output as JSON")
		.action((ref: string, opts: { yes?: boolean; json?: boolean }) =>
			runRotate(ref, opts),
		);
}
