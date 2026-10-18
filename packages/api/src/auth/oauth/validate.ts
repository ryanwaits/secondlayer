/**
 * Input checks for the OAuth endpoints: which redirect URIs a public client
 * may register, which client names may be shown on the consent page, and who
 * a rate limit counts.
 */

/** A redirect a public client may register: https, or http on a loopback
 *  host (RFC 8252 §7.3). No fragment, no userinfo, at most 512 characters. */
export function allowedRedirect(raw: string): boolean {
	if (raw.length > 512) return false;
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return false;
	}
	// `new URL` drops an empty `#`; the raw string must not carry one either.
	if (u.hash || raw.includes("#") || u.username || u.password) return false;
	if (u.protocol === "https:") return true;
	return (
		u.protocol === "http:" &&
		["127.0.0.1", "localhost", "[::1]"].includes(u.hostname.toLowerCase())
	);
}

/** Code points that print nothing or reorder text: C0/C1 controls, zero-width
 *  characters and marks, bidi overrides and isolates, invisible formatting,
 *  variation selectors and the Tag block. Written as numbers so no invisible
 *  character sits in the source. */
const INVISIBLE: [number, number][] = [
	[0x0000, 0x001f],
	[0x007f, 0x009f],
	[0x00ad, 0x00ad],
	[0x034f, 0x034f],
	[0x061c, 0x061c],
	[0x180e, 0x180e],
	[0x200b, 0x200f],
	[0x2028, 0x202e],
	[0x2060, 0x2064],
	[0x2066, 0x206f],
	[0xfe00, 0xfe0f],
	[0xfeff, 0xfeff],
	[0xfff9, 0xfffb],
	[0xe0000, 0xe007f],
	[0xe0100, 0xe01ef],
];

export function hasInvisible(s: string): boolean {
	for (const ch of s) {
		const cp = ch.codePointAt(0) ?? 0;
		if (INVISIBLE.some(([from, to]) => cp >= from && cp <= to)) return true;
	}
	return false;
}

/** Why a DCR `client_name` is refused, or null when it may be shown. It is the
 *  app's own claim, quoted on the consent page: one line, nothing hidden. */
export function clientNameProblem(name: unknown): string | null {
	if (typeof name !== "string") return "client_name: a string.";
	if (name.trim().length < 1 || [...name].length > 64)
		return "client_name: 1 to 64 characters.";
	if (hasInvisible(name))
		return "client_name: no control, zero-width, bidi or tag characters.";
	return null;
}

/**
 * Who a rate limit counts: an IPv4 address as itself, an IPv6 address by its
 * /64 (one host usually holds a whole /64, so counting single addresses would
 * let it rotate past every limit). IPv4-mapped IPv6 counts as the IPv4
 * address. Anything unparsable is its own key.
 */
export function rateKeyOf(ip: string): string {
	const raw = ip
		.trim()
		.replace(/^\[|\]$/g, "")
		.split("%")[0]
		.toLowerCase();
	if (!raw.includes(":")) return raw;
	const mapped = raw.match(
		/^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/,
	);
	if (mapped) return mapped[1];
	const [head, tail = ""] = raw.split("::");
	const left = head ? head.split(":") : [];
	// A dotted IPv4 tail fills the last two groups.
	const right = (tail ? tail.split(":") : []).flatMap((g) =>
		g.includes(".") ? ["0", "0"] : [g],
	);
	const groups = raw.includes("::")
		? [
				...left,
				...Array(Math.max(0, 8 - left.length - right.length)).fill("0"),
				...right,
			]
		: left;
	if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g)))
		return raw;
	return `${groups
		.slice(0, 4)
		.map((g) => g.padStart(4, "0"))
		.join(":")}::/64`;
}
