export function resolveAnchor(
	anchors: Record<string, unknown>,
	hash: string,
): string | null {
	let id = hash.replace(/^#/, "");
	try {
		id = decodeURIComponent(id);
	} catch {}
	if (Object.hasOwn(anchors, id)) return id;
	const base = id.split(".")[0];
	if (Object.hasOwn(anchors, base)) return base;
	if (Object.hasOwn(anchors, `${base}-object`)) return `${base}-object`;
	return null;
}
