import { isIPv6 } from "node:net";
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

/**
 * The rate-limit bucket for a client IP. IPv4 stays as is. An IPv6 address
 * collapses to its /64, the smallest block one subscriber is routinely handed,
 * so rotating the low 64 bits buys no extra budget. An IPv4-mapped IPv6
 * address buckets as the IPv4 it wraps. Anything else (including "unknown")
 * is returned unchanged.
 */
export function ipBucket(ip: string): string {
	const addr = ip.split("%")[0] ?? ip;
	if (!isIPv6(addr)) return ip;
	const groups = ipv6Groups(addr);
	if (!groups) return ip;
	const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
	if (
		g0 === 0 &&
		g1 === 0 &&
		g2 === 0 &&
		g3 === 0 &&
		g4 === 0 &&
		g5 === 0xffff
	) {
		return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
	}
	return `${[g0, g1, g2, g3].map((g) => g.toString(16)).join(":")}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 string, or null. */
function ipv6Groups(addr: string): number[] | null {
	let text = addr.toLowerCase();
	// A dotted tail (::ffff:1.2.3.4) becomes two hex groups.
	const dotted = text.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (dotted) {
		const [, head, a, b, c, d] = dotted.map(String);
		const hex = (hi: string, lo: string) =>
			((Number(hi) << 8) | Number(lo)).toString(16);
		text = `${head}${hex(a as string, b as string)}:${hex(c as string, d as string)}`;
	}
	const [left, right, extra] = text.split("::");
	if (extra !== undefined) return null;
	const parse = (s: string | undefined) =>
		s ? s.split(":").map((g) => Number.parseInt(g, 16)) : [];
	const head = parse(left);
	const tail = parse(right);
	const fill = 8 - head.length - tail.length;
	if (right === undefined ? fill !== 0 : fill < 1) return null;
	const groups = [...head, ...new Array<number>(fill).fill(0), ...tail];
	return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff)
		? groups
		: null;
}
