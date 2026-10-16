// Server-only: must never be imported from client code (pulls in undici).
import { Agent } from "undici";

/**
 * Upstream calls from route handlers to the API. undici closes an idle
 * keep-alive connection after 4 s by default, so a dashboard read that
 * follows a short pause paid a fresh TCP + TLS handshake to the API
 * (about +250 ms from Vercel iad1). The API's Caddy keeps idle connections
 * for 5 minutes; holding ours for 60 s keeps reads within a session warm.
 */
export const upstreamAgent = new Agent({
	keepAliveTimeout: 60_000,
	keepAliveMaxTimeout: 300_000,
});
