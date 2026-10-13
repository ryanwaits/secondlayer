/**
 * Remark plugin: MDX drops a fence's info string after the language. Copy it
 * onto the node as `data-meta` so `MdxPre` can read title and options.
 * Hand-walks the mdast (no unist-util-visit dependency). Registered by path
 * string in next.config.ts because Turbopack cannot serialize functions.
 */
function walk(node) {
	if (node.type === "code" && node.meta) {
		node.data = node.data ?? {};
		node.data.hProperties = {
			...node.data.hProperties,
			"data-meta": node.meta,
		};
	}
	if (Array.isArray(node.children)) {
		for (const child of node.children) walk(child);
	}
}

export default function remarkCodeMeta() {
	return (tree) => {
		walk(tree);
	};
}
