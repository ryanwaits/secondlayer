// Server-only: must never be imported from client code (pulls in undici).
import { Agent } from "undici";

/**
 * Upstream calls from route handlers to the API. undici closes an idle
 * keep-alive connection after 4 s by default, so a dashboard read that
 * follows a short pause paid a fresh TCP + TLS handshake to the API
 * (about +250 ms from Vercel iad1). The API's Caddy keeps idle connections
 * for 5 minutes; holding ours for 60 s keeps reads within a session warm.
 *
 * Kept on `globalThis`: Next bundles the server's startup hook and each route
 * separately, so this module can load more than once per process, and the
 * connection the startup warm-up opens must be the one the routes reuse.
 */
const AGENT_KEY = Symbol.for("secondlayer.upstreamAgent");
const shared = globalThis as unknown as { [AGENT_KEY]?: Agent };

shared[AGENT_KEY] ??= new Agent({
	keepAliveTimeout: 60_000,
	keepAliveMaxTimeout: 300_000,
});

export const upstreamAgent = shared[AGENT_KEY] as Agent;
