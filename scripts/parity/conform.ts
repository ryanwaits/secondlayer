/**
 * Conformance check: diffs the capability registry against the extractor
 * outputs in `out/`.
 *
 * Findings:
 *   phantom    registry claims an identifier no extract contains
 *   unclaimed  an extract item in a covered family that no capability claims
 *   gap        a capability declares a door as null (missing by admission)
 *   broken     a verify edge that names a nonexistent capability
 *
 * Also computes skill/docs coverage per capability from out/docs.json and
 * writes the full matrix to out/matrix.json for downstream rendering.
 *
 * Run from repo root (after the extractors): `bun scripts/parity/conform.ts`
 * Exits 1 when any finding exists.
 */
import { join } from "node:path";
import {
	type Capability,
	type Door,
	EXCLUDED,
	FAMILIES,
	capabilities,
} from "./registry.ts";

const OUT = join(import.meta.dir, "out");

interface ExtractItem {
	id: string;
	group?: string;
	hidden?: boolean;
	plane?: string;
}

async function loadItems(name: string): Promise<ExtractItem[]> {
	const file = Bun.file(join(OUT, `${name}.json`));
	if (!(await file.exists())) {
		throw new Error(`missing out/${name}.json — run the extractors first`);
	}
	return (await file.json()).items as ExtractItem[];
}

interface DocsMentions {
	cli: string[];
	mcp: string[];
	sdk: string[];
	http: string[];
}
interface DocsFile {
	path?: string;
	slug?: string;
	mentions: DocsMentions;
}

const DOORS: Door[] = ["cli", "sdk", "mcp", "http"];

const cli = await loadItems("cli");
const sdk = await loadItems("sdk");
const mcp = await loadItems("mcp");
const http = await loadItems("http");
const docs = await Bun.file(join(OUT, "docs.json")).json();

const extractIds: Record<Door, Set<string>> = {
	cli: new Set(cli.map((i) => i.id)),
	sdk: new Set(sdk.map((i) => i.id)),
	mcp: new Set(mcp.map((i) => i.id)),
	http: new Set(http.map((i) => i.id)),
};

const families = new Set<string>(FAMILIES);

function claimedIds(cap: Capability, door: Door): string[] {
	const value = cap.surfaces[door];
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}

// ── docs/skill mention matching (heuristic, precision-leaning) ─────────────
function cliMentionMatches(id: string, mention: string): boolean {
	return (
		id === mention ||
		id.startsWith(`${mention} `) ||
		mention.startsWith(`${id} `)
	);
}
function sdkMentionMatches(id: string, mention: string): boolean {
	return (
		id === mention ||
		id.startsWith(`${mention}.`) ||
		mention.startsWith(`${id}.`)
	);
}
function normalizePath(path: string): string[] {
	return path
		.replace(/\{[^}]+\}/g, "*")
		.replace(/:[A-Za-z_]+/g, "*")
		.split("/")
		.filter(Boolean);
}
function httpMentionMatches(claimed: string, mention: string): boolean {
	const claimedPath = claimed.split(" ").pop() ?? claimed;
	const a = normalizePath(claimedPath);
	const b = normalizePath(mention);
	if (a.length !== b.length) return false;
	return a.every((seg, i) => seg === "*" || b[i] === "*" || seg === b[i]);
}

function mentionedIn(cap: Capability, files: DocsFile[]): boolean {
	for (const file of files) {
		for (const door of DOORS) {
			for (const id of claimedIds(cap, door)) {
				const mentions = file.mentions?.[door] ?? [];
				const match =
					door === "cli"
						? mentions.some((m) => cliMentionMatches(id, m))
						: door === "sdk"
							? mentions.some((m) => sdkMentionMatches(id, m))
							: door === "http"
								? mentions.some((m) => httpMentionMatches(id, m))
								: mentions.includes(id);
				if (match) return true;
			}
		}
	}
	return false;
}

// ── checks ─────────────────────────────────────────────────────────────────
interface Finding {
	type: "phantom" | "unclaimed" | "gap" | "broken";
	door?: string;
	detail: string;
}
const findings: Finding[] = [];

// ── naming drift (report-only): each door's spelling should be a mechanical
// transform of the capability id; anything else is measurable naming drift ──
function kebab(part: string): string {
	return part.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
function expectedSpelling(door: Door, capId: string): string | null {
	const [family, ...rest] = capId.split(".");
	if (!family || rest.length === 0) return null;
	if (door === "cli") return [family, ...rest.map(kebab)].join(" ");
	if (door === "sdk") return capId;
	if (door === "mcp")
		return [family, ...rest.map((p) => kebab(p).replace(/-/g, "_"))].join("_");
	return null; // http paths are resources, not verbs; exempt
}
const namingDrift: string[] = [];

const capabilityIds = new Set(capabilities.map((c) => c.id));
const claimed: Record<Door, Set<string>> = {
	cli: new Set(),
	sdk: new Set(),
	mcp: new Set(),
	http: new Set(),
};

for (const cap of capabilities) {
	for (const door of DOORS) {
		for (const id of claimedIds(cap, door)) {
			if (!extractIds[door].has(id)) {
				findings.push({
					type: "phantom",
					door,
					detail: `${cap.id} claims ${door} "${id}" — not in the extract`,
				});
			}
			claimed[door].add(id);
		}
		{
			const ids = claimedIds(cap, door);
			const expected = expectedSpelling(door, cap.id);
			if (ids.length > 0 && expected && !ids.includes(expected)) {
				namingDrift.push(
					`${cap.id} ${door}: expected "${expected}", found "${ids.join('", "')}"`,
				);
			}
		}
		if (cap.surfaces[door] === null) {
			findings.push({
				type: "gap",
				door,
				detail: `${cap.id} missing from ${door}`,
			});
		}
	}
	if (cap.verify && !capabilityIds.has(cap.verify)) {
		findings.push({
			type: "broken",
			detail: `${cap.id} verify edge names unknown capability "${cap.verify}"`,
		});
	}
}

function isExcluded(door: Door, id: string): boolean {
	if (EXCLUDED[`${door}:${id}`]) return true;
	// wildcard exclusions like "sdk:trigger.*"
	return Object.keys(EXCLUDED).some((key) => {
		const [keyDoor, pattern] = key.split(":");
		return (
			keyDoor === door &&
			pattern?.endsWith(".*") &&
			id.startsWith(pattern.slice(0, -1))
		);
	});
}

const allExtracts: Record<Door, ExtractItem[]> = { cli, sdk, mcp, http };
for (const door of DOORS) {
	for (const item of allExtracts[door]) {
		if (!families.has(item.group ?? "")) continue;
		if (item.plane === "deleted") continue;
		if (claimed[door].has(item.id)) continue;
		if (isExcluded(door, item.id)) continue;
		findings.push({
			type: "unclaimed",
			door,
			detail: `${door} "${item.id}" is claimed by no capability`,
		});
	}
}

// ── matrix for downstream rendering ────────────────────────────────────────
const skillFiles: DocsFile[] = docs.skill?.files ?? [];
const sitePages: DocsFile[] = docs.site?.pages ?? [];

type CellState = "present" | "gap" | "na";
interface MatrixRow {
	id: string;
	title: string;
	kind: string;
	verify?: string;
	cells: Record<string, { state: CellState; ids?: string[]; reason?: string }>;
}

const matrix: MatrixRow[] = capabilities.map((cap) => {
	const cells: MatrixRow["cells"] = {};
	for (const door of DOORS) {
		if (!(door in cap.surfaces)) {
			cells[door] = { state: "na", reason: cap.naReason?.[door] };
		} else if (cap.surfaces[door] === null) {
			cells[door] = { state: "gap" };
		} else {
			cells[door] = { state: "present", ids: claimedIds(cap, door) };
		}
	}
	cells.skill = { state: mentionedIn(cap, skillFiles) ? "present" : "gap" };
	cells.docs = { state: mentionedIn(cap, sitePages) ? "present" : "gap" };
	return {
		id: cap.id,
		title: cap.title,
		kind: cap.kind,
		verify: cap.verify,
		cells,
	};
});

await Bun.write(
	join(OUT, "matrix.json"),
	`${JSON.stringify({ generated: "conform.ts", families: FAMILIES, findings, namingDrift, matrix }, null, "\t")}\n`,
);

// ── report ─────────────────────────────────────────────────────────────────
const byType = (type: Finding["type"]) =>
	findings.filter((f) => f.type === type);

console.log(
	`  extract  cli ${cli.length} · sdk ${sdk.length} · http ${http.length} · mcp ${mcp.length}`,
);
console.log(
	`  registry ${capabilities.length} capabilities across ${FAMILIES.join(" · ")}`,
);
for (const type of ["phantom", "broken", "unclaimed", "gap"] as const) {
	for (const finding of byType(type)) {
		console.log(`✗ ${type.padEnd(9)} ${finding.detail}`);
	}
}
for (const drift of namingDrift) {
	console.log(`~ naming    ${drift}`);
}
const docsGaps = matrix.filter((r) => r.cells.docs?.state === "gap").length;
const skillGaps = matrix.filter((r) => r.cells.skill?.state === "gap").length;
console.log(
	`  docs coverage: ${matrix.length - docsGaps}/${matrix.length} on the docs site, ${matrix.length - skillGaps}/${matrix.length} in the skill (heuristic, report-only)`,
);

if (findings.length === 0) {
	console.log("✓ conform passed — every door agrees with the registry");
} else {
	console.log(
		`${findings.length} findings (${byType("gap").length} gaps, ${byType("unclaimed").length} unclaimed, ${byType("phantom").length} phantom, ${byType("broken").length} broken) · conform failed`,
	);
	process.exit(1);
}
