import { AuthenticationError } from "@secondlayer/shared/errors";
import { isPlatformMode } from "@secondlayer/shared/mode";
import type { Context, MiddlewareHandler } from "hono";
import { instanceTokenMatches, isLoopbackReachable } from "../instance-bind.ts";

/**
 * One auth rule for the whole `/v1` read plane.
 *
 * A self-hosted instance has exactly one credential — `INSTANCE_TOKEN` from
 * `secondlayer init` (`SL_API_KEY`/`API_KEY` are legacy aliases). There are no
 * accounts and no minted product keys. The rule, identical on Index, Streams,
 * and subgraphs:
 *
 *   - loopback bind  → reads are open, no credential
 *   - public bind    → every request needs the instance token
 *   - a credential presented where anonymous access is allowed is resolved if
 *     we recognize it and otherwise ignored — never fatal. Presenting a key
 *     must not turn a working read into a 401.
 *
 * The metered archive (`platform`) keeps its own per-plane posture; it is
 * passed in explicitly by each plane so the divergence stays visible.
 */

/** Tenant id for a caller who authenticated with the instance's own token. */
export const INSTANCE_TENANT_ID = "tenant_instance";

const HINT =
	"Self-hosted instances have one credential: INSTANCE_TOKEN from `secondlayer init` (SL_API_KEY/API_KEY are legacy aliases). Send it as `Authorization: Bearer $INSTANCE_TOKEN`. Reads over loopback need no key at all; a bind past loopback requires the token on every request.";

const HINT_DETAILS = {
	hint: HINT,
	env_var: "INSTANCE_TOKEN",
	header: "Authorization: Bearer $INSTANCE_TOKEN",
	docs: "https://www.secondlayer.tools/docs/authentication",
} as const;

export function missingCredentialError(): AuthenticationError {
	return new AuthenticationError(
		"Missing or invalid Authorization header",
		HINT_DETAILS,
	);
}

export function invalidCredentialError(): AuthenticationError {
	return new AuthenticationError("Unrecognized API key", HINT_DETAILS);
}

/**
 * Whether this request may be served without a credential.
 *
 * Self-hosted: exactly when the API is reachable only from this box (see
 * `isLoopbackReachable` — the operator's declared publish/bind, never a
 * spoofable peer address). Read per request so an operator's env is
 * authoritative at call time, not at module load.
 */
export function allowsAnonymousRead(opts?: {
	/** Posture on the metered archive deployment, which is not loopback-bound.
	 *  Index and subgraphs serve public anon reads there; Streams is keyed. */
	platform?: boolean;
	env?: NodeJS.ProcessEnv;
}): boolean {
	if (isPlatformMode()) return opts?.platform ?? true;
	return isLoopbackReachable(opts?.env ?? process.env);
}

/** The bearer token on a request, or null when there is no usable one. */
export function bearerToken(c: Context): string | null {
	const header = c.req.header("authorization");
	if (!header?.startsWith("Bearer ")) return null;
	const raw = header.slice(7).trim();
	return raw.length > 0 ? raw : null;
}

/**
 * `/v1` routes that carry no token store of their own (contracts, the instance
 * catalog, the directory, openapi, batch): open on a loopback bind, instance
 * token required otherwise.
 *
 * Planes that do have a token store (Index, Streams, subgraphs) enforce the
 * same rule themselves, because they also accept first-party service
 * credentials such as the internal decoder key — this gate would reject those.
 */
const PLANE_AUTH_PREFIXES = ["/v1/index", "/v1/streams", "/v1/subgraphs"];

export function v1InstanceGate(): MiddlewareHandler {
	return async (c, next) => {
		if (allowsAnonymousRead()) {
			await next();
			return;
		}
		const raw = bearerToken(c);
		if (raw !== null && instanceTokenMatches(raw)) {
			await next();
			return;
		}
		const path = c.req.path;
		if (
			PLANE_AUTH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
		) {
			await next();
			return;
		}
		throw raw === null ? missingCredentialError() : invalidCredentialError();
	};
}
