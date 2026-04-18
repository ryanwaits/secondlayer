"use client";

import { createRenderer } from "@json-render/react";
import {
	atomComponentMap,
	atoms,
	defineCatalog,
	schema,
} from "@secondlayer/stacks/ui";

// Dashboard-wide catalog bound to the built-in Stacks atoms. Any
// `step.render` output whose spec references an atom name we know gets
// rendered. Unknown component names fall through to `fallback`.
const dashboardCatalog = defineCatalog(schema, {
	components: atoms,
	actions: {},
});

const Renderer = createRenderer(dashboardCatalog, atomComponentMap);

interface Props {
	output: unknown;
}

/**
 * Render a `step.render` output (json-render spec) using the Stacks atoms
 * component map. Falls back to raw JSON if the output doesn't match the
 * catalog spec shape.
 */
export function WorkflowRenderOutput({ output }: Props) {
	const spec = extractSpec(output);
	if (!spec) {
		return (
			<pre
				style={{
					fontFamily: "var(--font-mono-stack)",
					fontSize: 11,
					whiteSpace: "pre-wrap",
					wordBreak: "break-all",
					margin: 0,
				}}
			>
				{JSON.stringify(output, null, 2)}
			</pre>
		);
	}
	return (
		<div className="sl-workflow-render">
			<Renderer
				spec={spec as never}
				fallback={({ element }) => (
					<span style={{ color: "var(--text-muted)", fontSize: 11 }}>
						[unknown component: {(element as { type?: string }).type ?? "?"}]
					</span>
				)}
			/>
		</div>
	);
}

function extractSpec(output: unknown): unknown {
	if (output == null || typeof output !== "object") return null;
	const o = output as Record<string, unknown>;
	if (o.spec && typeof o.spec === "object") return o.spec;
	if (o.root && o.elements) return o;
	return null;
}
