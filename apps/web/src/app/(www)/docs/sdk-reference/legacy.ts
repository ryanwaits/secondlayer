export function resolveLegacy(
	owners: Readonly<Record<string, string>>,
	hash: string,
): string | null {
	let id = hash.replace(/^#/, "");
	try {
		id = decodeURIComponent(id);
	} catch {}
	return Object.hasOwn(owners, id) ? (owners[id] as string) : null;
}
