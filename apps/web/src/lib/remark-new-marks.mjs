/**
 * Remark plugin: a "new" mark (`{/* new: YYYY-MM-DD *\/}`, see docs-new.mjs)
 * rides onto the heading right after it as `data-new`, where the docs sidebar
 * reads it. Registered by absolute path in next.config.ts because Turbopack
 * cannot serialize functions.
 */
import { NEW_MARK_BODY } from "./docs-new.mjs";

export default function remarkNewMarks() {
	return (tree) => {
		const nodes = tree.children ?? [];
		nodes.forEach((node, i) => {
			if (node.type !== "mdxFlowExpression") return;
			const date = NEW_MARK_BODY.exec(node.value ?? "")?.[1];
			const next = nodes[i + 1];
			if (!date || next?.type !== "heading") return;
			next.data ??= {};
			next.data.hProperties = { ...next.data.hProperties, "data-new": date };
		});
	};
}
