import type { Context } from "hono";

/**
 * Extract the client IP from a Hono context.
 *
 * Behind a trusted reverse proxy (prod = Caddy, which appends the real source IP
 * it observed to the END of `X-Forwarded-For`), the client IP is `TRUSTED_PROXY_HOPS`
 * entries in from the right (default 1 = one proxy → the last entry). We never read
 * `XFF[0]`: it is fully attacker-controlled, and trusting it let a caller rotate a
 * forged value per request to defeat IP rate limits.
 *
 * `cf-connecting-ip` is trusted only when `TRUST_CF_CONNECTING_IP=true` — we are not
 * behind Cloudflare in prod, so by default trusting it would be another spoofable
 * input. Returns "unknown" when no trusted source is available (callers must treat
 * "unknown" as fail-closed, not as an exemption).
 */
export function getClientIp(c: Context): string {
	if (process.env.TRUST_CF_CONNECTING_IP === "true") {
		const cf = c.req.header("cf-connecting-ip")?.trim();
		if (cf) return cf;
	}
	const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10);
	if (hops > 0) {
		const parts = c.req
			.header("x-forwarded-for")
			?.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		// The trusted proxy appends the source IP it saw to the tail; the real
		// client sits `hops` from the end. Fewer entries than hops → can't trust.
		const ip = parts?.[parts.length - hops];
		if (ip) return ip;
	}
	return "unknown";
}
