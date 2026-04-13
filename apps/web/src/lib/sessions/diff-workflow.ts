import { highlight } from "@/lib/highlight";
import { structuredPatch } from "diff";

export type DiffLine =
	| { type: "ctx"; oldLine: number; newLine: number; html: string }
	| { type: "add"; newLine: number; html: string }
	| { type: "del"; oldLine: number; html: string };

export interface DiffHunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffLine[];
}

export interface WorkflowDiff {
	hunks: DiffHunk[];
	added: number;
	removed: number;
}

async function highlightLine(content: string): Promise<string> {
	const html = await highlight(content || " ", "typescript");
	return html;
}

/** Build a server-rendered unified diff between the current and proposed source. */
export async function buildWorkflowDiff(
	currentSource: string,
	proposedSource: string,
	filename: string,
): Promise<WorkflowDiff> {
	const patch = structuredPatch(
		filename,
		filename,
		currentSource,
		proposedSource,
		"",
		"",
		{ context: 3 },
	);

	let added = 0;
	let removed = 0;

	const hunks: DiffHunk[] = [];
	for (const h of patch.hunks) {
		let oldCursor = h.oldStart;
		let newCursor = h.newStart;
		const lines: DiffLine[] = [];

		for (const raw of h.lines) {
			if (raw.startsWith("\\ ")) continue; // "\ No newline at end of file" marker
			const marker = raw.charAt(0);
			const content = raw.slice(1);
			const html = await highlightLine(content);
			if (marker === "+") {
				lines.push({ type: "add", newLine: newCursor, html });
				newCursor += 1;
				added += 1;
			} else if (marker === "-") {
				lines.push({ type: "del", oldLine: oldCursor, html });
				oldCursor += 1;
				removed += 1;
			} else {
				lines.push({
					type: "ctx",
					oldLine: oldCursor,
					newLine: newCursor,
					html,
				});
				oldCursor += 1;
				newCursor += 1;
			}
		}

		hunks.push({
			oldStart: h.oldStart,
			oldLines: h.oldLines,
			newStart: h.newStart,
			newLines: h.newLines,
			lines,
		});
	}

	return { hunks, added, removed };
}
