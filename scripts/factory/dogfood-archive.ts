/**
 * Factory adapter: one-time import of the archived Dogfood findings.
 * Reads <dir>/findings/*.json. Idempotent: the factory dedupes on (adapter, id).
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";

type Incoming = {
	kind: "new";
	id: string;
	project: string;
	title?: string;
	body: string;
	requester: { name: string; ref?: string };
};
type Adapter = { name: string; pull(ctx: unknown): Promise<Incoming[]> };

// Archived files, not agent output: lenient, unknown keys allowed.
const FindingSchema = z.object({
	// Export docs carry no id field: the doc id is the file name.
	id: z.string().optional(),
	title: z.string(),
	state: z.string().optional(),
	outcome: z.string().optional(),
	proposal: z.string().optional(),
	rank: z.number().optional(),
	why: z.string().optional(),
	impact: z.string().optional(),
	fix: z.string().optional(),
	surfaces: z.array(z.string()).optional(),
	runIds: z.array(z.string()).optional(),
	tickets: z
		.array(z.object({ id: z.string(), intent: z.string().optional() }))
		.optional(),
	evidence: z
		.object({
			title: z.string().optional(),
			kind: z.string().optional(),
			code: z.string().optional(),
		})
		.optional(),
	deployedAt: z.string().optional(),
	decision: z
		.object({ choice: z.string().optional(), at: z.string().optional() })
		.optional(),
});
type Finding = Omit<z.infer<typeof FindingSchema>, "id"> & { id: string };

function readFindings(dir: string): Finding[] {
	const root = join(dir, "findings");
	return readdirSync(root)
		.filter((f) => f.endsWith(".json"))
		.map((f): Finding => {
			const doc = FindingSchema.parse(
				JSON.parse(readFileSync(join(root, f), "utf8")),
			);
			return { ...doc, id: doc.id ?? basename(f, ".json") };
		})
		.sort(
			(a, b) =>
				(a.rank ?? Number.MAX_SAFE_INTEGER) -
					(b.rank ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
		);
}

export function archivedTicketIds(dir: string): string[] {
	// A ticket can back several findings: return each id once.
	return [
		...new Set(
			readFindings(dir).flatMap((f) => (f.tickets ?? []).map((t) => t.id)),
		),
	];
}

function toIncoming(f: Finding, project: string): Incoming {
	const lines: string[] = [];
	if (f.why) lines.push(f.why, "");
	if (f.impact) lines.push(`Impact: ${f.impact}`);
	const proposed = [f.proposal, f.fix].filter(Boolean).join(" - ");
	if (proposed) lines.push(`Proposed: ${proposed}`);
	if (f.surfaces?.length) lines.push(`Surfaces: ${f.surfaces.join(", ")}`);
	if (f.evidence) {
		lines.push(
			`Evidence (${f.evidence.kind ?? "none"}): ${f.evidence.title ?? ""}`.trimEnd(),
		);
		if (f.evidence.code) lines.push("```", f.evidence.code, "```");
	}
	if (f.tickets?.length) {
		lines.push("Tickets:");
		for (const t of f.tickets)
			lines.push(`${t.id.slice(0, 8)} ${t.intent ?? ""}`.trimEnd());
	}
	if (f.runIds?.length) lines.push(`Dogfood runs: ${f.runIds.join(", ")}`);
	let state = `Dogfood state: ${f.state ?? "unknown"}`;
	if (f.outcome) state += `, ${f.outcome}`;
	if (f.deployedAt) state += `, deployed ${f.deployedAt}`;
	if (f.decision?.choice)
		state += `, decision ${f.decision.choice} at ${f.decision.at ?? "unknown"}`;
	lines.push(state);
	return {
		kind: "new",
		id: f.id,
		project,
		title: f.title,
		body: lines.join("\n"),
		requester: { name: "dogfood" },
	};
}

export function dogfoodArchive(opts: {
	dir: string;
	project: string;
}): Adapter {
	return {
		name: "dogfood-archive",
		pull: async () =>
			readFindings(opts.dir).map((f) => toIncoming(f, opts.project)),
	};
}
