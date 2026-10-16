/** Long commands show first 38 + "…" + last 18; Copy still copies the whole thing. */
export function truncateMiddle(cmd: string, max = 64, head = 38, tail = 18) {
	if (cmd.length <= max) return cmd;
	return `${cmd.slice(0, head)}…${cmd.slice(-tail)}`;
}

function decode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/** The CLI command that shows the same thing as an account route; null = no footer. */
export function commandForPath(
	pathname: string | null,
	nameForId?: (id: string) => string | undefined,
): string | null {
	if (!pathname) return null;
	if (pathname === "/account") return "sl status";
	if (pathname === "/account/webhooks") return "sl webhooks list";
	if (pathname === "/account/credits") return "sl credits balance";
	if (pathname === "/account/keys") return "sl whoami";
	const detail = /^\/account\/webhooks\/([^/]+)$/.exec(pathname);
	if (detail) {
		const id = decode(detail[1]);
		return `sl webhooks doctor ${nameForId?.(id) ?? id}`;
	}
	return null;
}
