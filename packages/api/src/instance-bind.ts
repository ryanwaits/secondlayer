/**
 * Self-host bind + token policy.
 *
 * Loopback is open with no token. A non-loopback listen without
 * INSTANCE_TOKEN (or API_KEY) refuses to start. If a token is set it is
 * required on every request except health/public.
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
