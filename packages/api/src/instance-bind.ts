import { timingSafeEqual } from "node:crypto";

/**
 * Self-host bind + token policy.
 *
 * A non-loopback listen without INSTANCE_TOKEN (or API_KEY) refuses to start,
 * so a reachable instance always has a credential.
 *
 * What that token then gates (see `auth/read-plane.ts`):
 *   - `/v1` reads    — open while the API is reachable only from this box,
 *                      whether or not a token is set; required on every
 *                      request once it is reachable from anywhere else.
 *   - writes (`/api`) — required whenever a token is set, loopback included.
 *
 * "Reachable only from this box" is the declared bind, except in a container,
 * where the bind must be `0.0.0.0` and the operator's intent lives in the
 * publish spec instead (`API_PUBLISH_ADDR`). See `isLoopbackReachable`.
 *
 * (An earlier version of this comment claimed the token gated *every* request
 * once set. It never did: `instanceTokenAuth` is mounted on the write plane
 * and `/status` only, and the docs promise keyless loopback reads.)
 */

export const LOOPBACK_HOSTS = new Set([
	"127.0.0.1",
	"::1",
	"localhost",
	"0:0:0:0:0:0:0:1",
]);

export function isLoopbackHost(host: string): boolean {
	const normalized = host
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "");
	return LOOPBACK_HOSTS.has(normalized);
}

export function resolveListenHost(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const raw = (env.LISTEN_HOST ?? env.HOST ?? "127.0.0.1").trim();
	return raw.length > 0 ? raw : "127.0.0.1";
}

export function resolveInstanceToken(
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	const raw = (env.INSTANCE_TOKEN ?? env.API_KEY)?.trim();
	return raw && raw.length > 0 ? raw : null;
}

/**
 * True when the process listens on a loopback address, i.e. the socket is
 * unreachable from anywhere but this box.
 *
 * This is the bind the operator declared (`LISTEN_HOST`/`HOST`), never the
 * peer address of the request: a same-box reverse proxy makes every remote
 * caller look like 127.0.0.1, and `X-Forwarded-For` is caller-controlled.
 * Anything other than a loopback listen is treated as public.
 */
export function isLoopbackBind(env: NodeJS.ProcessEnv = process.env): boolean {
	return isLoopbackHost(resolveListenHost(env));
}

/**
 * The host of a Docker-style publish spec, or null when it names none.
 *
 * Accepts what an operator writes in a compose `ports:` entry —
 * `127.0.0.1:3800`, `0.0.0.0:3800`, `[::1]:3800`, `3800`, and the full
 * `127.0.0.1:3800:3800` form. A bare port publishes on every interface, so
 * "no host" is a real answer meaning public, not an error.
 *
 * Every ambiguity resolves toward public: only a spec that explicitly names a
 * host can ever be read as loopback.
 */
export function parsePublishHost(spec: string): string | null {
	const raw = spec.trim();
	if (raw.length === 0) return null;

	// Bracketed IPv6: [::1]:3800 — the only unambiguous v6 form.
	if (raw.startsWith("[")) {
		const close = raw.indexOf("]");
		if (close <= 1) return null;
		return raw.slice(1, close);
	}

	const parts = raw.split(":");
	// "3800" — a bare container port. Docker publishes it on all interfaces.
	if (parts.length === 1) return null;
	// "host:port" or "host:hostPort:containerPort". More colons than that is
	// an unbracketed IPv6 spec we refuse to guess at.
	if (parts.length > 3) return null;
	const host = parts[0]?.trim();
	return host && host.length > 0 ? host : null;
}

/**
 * True when the API is reachable only from this box.
 *
 * In a container the listen host cannot express this: the process must bind
 * `0.0.0.0` or Docker's published port can never reach it. The operator's
 * actual intent lives in the publish spec, so `API_PUBLISH_ADDR` — which
 * compose sets from the very value it publishes with — wins when present.
 * Without it we fall back to the declared bind, which is right for a bare
 * `bun run` / systemd instance.
 *
 * Fails safe at every step: unset falls back to the bind, a spec naming no
 * host is public, an unparseable spec is public. Only an explicit loopback
 * host opens reads. This can only ever *open* a read plane that the bind
 * already protects — it is not consulted by the boot guard, so a public bind
 * still refuses to start without a token.
 */
export function isLoopbackReachable(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const spec = env.API_PUBLISH_ADDR?.trim();
	if (spec === undefined || spec.length === 0) return isLoopbackBind(env);
	const host = parsePublishHost(spec);
	return host === null ? false : isLoopbackHost(host);
}

/**
 * Constant-time comparison of a presented bearer against the instance token.
 * False when no token is configured — an unset token authenticates nobody.
 */
export function instanceTokenMatches(
	provided: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const expected = resolveInstanceToken(env);
	if (expected === null || provided.length === 0) return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export class UnauthenticatedBindError extends Error {
	readonly name = "UnauthenticatedBindError";
	constructor(readonly host: string) {
		super(
			`refusing to bind ${host} without INSTANCE_TOKEN (or API_KEY). Loopback is open; a public bind requires a token.`,
		);
	}
}

export function assertInstanceBindAuth(input: {
	host: string;
	token: string | null;
}): void {
	if (!isLoopbackHost(input.host) && input.token === null) {
		throw new UnauthenticatedBindError(input.host);
	}
}

export type InstanceAuthDecision =
	| { start: true; requireToken: false }
	| { start: true; requireToken: true }
	| { start: false; reason: "unauthenticated-bind" };

/** Bind/auth matrix used by tests and boot. */
export function decideInstanceAuth(input: {
	host: string;
	token: string | null;
}): InstanceAuthDecision {
	if (!isLoopbackHost(input.host) && input.token === null) {
		return { start: false, reason: "unauthenticated-bind" };
	}
	if (input.token !== null) {
		return { start: true, requireToken: true };
	}
	return { start: true, requireToken: false };
}
