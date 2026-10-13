/**
 * The endpoint or object a URL hash names, among the anchors a page holds.
 * A field's own anchor (`list-ft-transfers.limit`, `ft-transfer.amount`)
 * names its endpoint or object, so a shared field link opens the right
 * drawer. Null when the hash names nothing the drawer shows.
 */
export function resolveAnchor(
	anchors: Record<string, unknown>,
	hash: string,
): string | null {
	let id = hash.replace(/^#/, "");
	try {
		id = decodeURIComponent(id);
	} catch {
		// A malformed escape names nothing.
	}
	if (Object.hasOwn(anchors, id)) return id;
	const base = id.split(".")[0];
	if (Object.hasOwn(anchors, base)) return base;
	if (Object.hasOwn(anchors, `${base}-object`)) return `${base}-object`;
	return null;
}
