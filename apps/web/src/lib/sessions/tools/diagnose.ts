import { tool } from "ai";
import { z } from "zod";
import type { AccountResources } from "./factory";

interface Finding {
	resource: string;
	resourceType: "stream" | "subgraph";
	severity: "danger" | "warning" | "info";
	title: string;
	description: string;
	suggestion: string;
}

export function createDiagnose(resources: AccountResources) {
	return tool({
		description:
			"Diagnose the health of streams or subgraphs. Returns structured findings with severity, description, and suggested actions.",
		inputSchema: z.object({
			resourceType: z
				.enum(["stream", "subgraph"])
				.describe("Type of resource to diagnose"),
			resourceId: z
				.string()
				.optional()
				.describe("Specific resource ID or name. Omit to diagnose all."),
		}),
		execute: async ({ resourceType, resourceId }) => {
			const findings: Finding[] = [];

			if (resourceType === "subgraph") {
				const targets = resourceId
					? resources.subgraphs.filter((s) => s.name === resourceId)
					: resources.subgraphs;
				const chainTip = resources.chainTip;

				for (const s of targets) {
					// Error state
					if (s.status === "error") {
						findings.push({
							resource: s.name,
							resourceType: "subgraph",
							severity: "danger",
							title: `${s.name} — error state`,
							description: `Subgraph has ${s.totalErrors} errors.`,
							suggestion:
								"Check handler code for runtime errors. Consider reindexing.",
						});
						continue;
					}

					// Stalled (>50 blocks behind chain tip)
					if (
						chainTip != null &&
						s.lastProcessedBlock != null &&
						chainTip - s.lastProcessedBlock > 50
					) {
						const behind = chainTip - s.lastProcessedBlock;
						findings.push({
							resource: s.name,
							resourceType: "subgraph",
							severity: "warning",
							title: `${s.name} — ${behind} blocks behind`,
							description: `Last processed block ${s.lastProcessedBlock.toLocaleString()}, chain tip is ${chainTip.toLocaleString()}.`,
							suggestion:
								"This may catch up on its own. If stuck, try reindexing.",
						});
						continue;
					}

					// High error count
					if (s.totalErrors > 0 && s.totalProcessed > 0) {
						const errorRate = s.totalErrors / s.totalProcessed;
						if (errorRate > 0.1) {
							findings.push({
								resource: s.name,
								resourceType: "subgraph",
								severity: "warning",
								title: `${s.name} — ${Math.round(errorRate * 100)}% error rate`,
								description: `${s.totalErrors} errors out of ${s.totalProcessed} processed blocks.`,
								suggestion: "Review handler code for edge cases.",
							});
						}
					}
				}
			}

			if (findings.length === 0) {
				findings.push({
					resource: "all",
					resourceType,
					severity: "info",
					title: `All ${resourceType}s healthy`,
					description: `No issues detected across your ${resourceType}s.`,
					suggestion: "",
				});
			}

			return { findings };
		},
	});
}
