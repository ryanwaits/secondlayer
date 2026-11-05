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

/** The CLI command that shows the same thing as an account route; null = no
 *  footer. A detail page whose webhook or subgraph is gone (`isMissing`) gets
 *  its list command: there's nothing left to inspect. */
export function commandForPath(
	pathname: string | null,
	nameForId?: (id: string) => string | undefined,
	isMissing?: (kind: "webhooks" | "subgraphs", key: string) => boolean,
): string | null {
	if (!pathname) return null;
	if (pathname === "/account") return "sl status";
	if (pathname === "/account/rows") return "sl credits usage";
	if (pathname === "/account/webhooks") return "sl webhooks list";
	if (pathname === "/account/subgraphs") return "sl subgraphs list";
	if (pathname === "/account/credits") return "sl credits balance";
	if (pathname === "/account/keys") return "sl whoami";
	const detail = /^\/account\/webhooks\/([^/]+)$/.exec(pathname);
	if (detail) {
		const id = decode(detail[1]);
		if (isMissing?.("webhooks", id)) return "sl webhooks list";
		return `sl webhooks doctor ${nameForId?.(id) ?? id}`;
	}
	const subgraph = /^\/account\/subgraphs\/([^/]+)$/.exec(pathname);
	if (subgraph) {
		const name = decode(subgraph[1]);
		if (isMissing?.("subgraphs", name)) return "sl subgraphs list";
		return `sl subgraphs status ${name}`;
	}
	return null;
}
