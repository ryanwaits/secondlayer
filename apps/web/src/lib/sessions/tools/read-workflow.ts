import { apiRequest } from "@/lib/api";
import { highlight } from "@/lib/highlight";
import { tool } from "ai";
import { z } from "zod";

interface WorkflowSourceResponse {
	name: string;
	version: string;
	sourceCode: string | null;
	readOnly: boolean;
	reason?: string;
	triggerType: string;
	triggerConfig: Record<string, unknown> | null;
	updatedAt: string;
}

/** Extract `ctx.input.X` field references from workflow source. */
function extractInputFields(source: string): string[] {
	const fields = new Set<string>();
	const re = /ctx\.input\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
	let m: RegExpExecArray | null;
	m = re.exec(source);
	while (m !== null) {
		fields.add(m[1]);
		m = re.exec(source);
	}
	return [...fields];
}

export function createReadWorkflow(sessionToken: string) {
	return tool({
		description:
			"Fetch the deployed TypeScript source of a workflow, plus its stored version, trigger config, and any `ctx.input.X` field references. ALWAYS call this before edit_workflow so you pass the exact source the user will see in the diff. ALSO call this before triggering a manual workflow so you know which input fields to populate. Returns `{ readOnly: true, reason }` for workflows deployed before source capture — in that case tell the user to redeploy via CLI before editing from chat.",
		inputSchema: z.object({
			name: z.string().describe("Workflow name"),
		}),
		execute: async ({ name }) => {
			try {
				const data = await apiRequest<WorkflowSourceResponse>(
					`/api/workflows/${name}/source`,
					{ sessionToken },
				);
				const declaredInput =
					(data.triggerConfig?.input as Record<string, unknown> | undefined) ??
					null;
				if (data.sourceCode === null) {
					return {
						name: data.name,
						version: data.version,
						readOnly: true,
						reason:
							data.reason ??
							"deployed before source-capture — redeploy to enable chat edits",
						triggerType: data.triggerType,
						declaredInput,
						updatedAt: data.updatedAt,
					};
				}
				const html = await highlight(data.sourceCode, "typescript");
				const inputFieldRefs = extractInputFields(data.sourceCode);
				return {
					name: data.name,
					version: data.version,
					readOnly: false,
					sourceCode: data.sourceCode,
					html,
					filename: `workflows/${data.name}.ts`,
					triggerType: data.triggerType,
					declaredInput,
					inputFieldRefs,
					updatedAt: data.updatedAt,
				};
			} catch (err) {
				return {
					error: true,
					message: err instanceof Error ? err.message : String(err),
				};
			}
		},
	});
}
