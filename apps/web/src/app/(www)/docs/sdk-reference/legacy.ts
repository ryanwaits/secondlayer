/**
 * Where an old `/docs/sdk-reference#x-<name>` link goes now. The reference
 * used to be one page; each export had an `x-` anchor and each area a slug.
 * Null when the hash names nothing that moved (the overview's own anchors).
 */
export function resolveLegacy(
	owners: Readonly<Record<string, string>>,
	hash: string,
): string | null {
	let id = hash.replace(/^#/, "");
	try {
		id = decodeURIComponent(id);
	} catch {
		// A malformed escape names nothing.
	}
	return Object.hasOwn(owners, id) ? (owners[id] as string) : null;
}
