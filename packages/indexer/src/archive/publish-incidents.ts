#!/usr/bin/env bun
/**
 * Publish incident reports to the archive as signed, immutable objects.
 *
 * An archive that only publishes its successes is marketing. The claim this
 * project makes — that we will tell you the truth about chain data — is only
 * worth anything if it holds when the truth is unflattering about us. So our
 * own defects get published on the same terms as everything else: signed,
 * addressed under the archive root, and listed in an index a consumer can
 * enumerate without asking.
 *
 * Reports are content-addressed by id and immutable once published. A
 * correction is a NEW report that supersedes an old one, never an edit — an
 * incident log that can be quietly rewritten is not evidence.
 *
 * Usage:
 *   bun run packages/indexer/src/archive/publish-incidents.ts           # dry-run
 *   bun run packages/indexer/src/archive/publish-incidents.ts --apply
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { signStreamsBulkManifest } from "@secondlayer/shared/streams-bulk-manifest";
import {
	createStreamsBulkS3Client,
	getStreamsBulkR2ConfigFromEnv,
	putJsonObject,
} from "../streams-bulk/upload.ts";
import { CANONICAL_ARCHIVE_PREFIX } from "./upload-snapshot.ts";

export type IncidentReport = {
	schema_version: number;
	id: string;
	date: string;
	title: string;
	severity: string;
	affects_archive: boolean;
	summary: string;
	[key: string]: unknown;
};

export type IncidentIndex = {
	schema_version: 1;
	updated_at: string;
	incidents: Array<{
		id: string;
		date: string;
		title: string;
		severity: string;
		affects_archive: boolean;
		path: string;
	}>;
	signature?: string;
	key_id?: string;
};

const REQUIRED_FIELDS = [
	"id",
	"date",
	"title",
	"severity",
	"summary",
	"root_cause",
] as const;

/** A report missing its root cause is a notification, not an incident report. */
export function validateReport(report: IncidentReport, file: string): void {
	for (const field of REQUIRED_FIELDS) {
		if (!report[field]) {
			throw new Error(`${file}: missing required field "${field}"`);
		}
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(report.date)) {
		throw new Error(`${file}: date must be YYYY-MM-DD, got "${report.date}"`);
	}
	if (!report.id.startsWith(report.date)) {
		// Keeps the index chronologically sortable by id alone.
		throw new Error(`${file}: id must start with its date`);
	}
}

export async function loadReports(dir: string): Promise<IncidentReport[]> {
	const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
	const reports: IncidentReport[] = [];
	for (const file of files) {
		const report = JSON.parse(
			await readFile(join(dir, file), "utf8"),
		) as IncidentReport;
		validateReport(report, file);
		reports.push(report);
	}
	return reports;
}

export function buildIndex(
	reports: readonly IncidentReport[],
	updatedAt: string,
): IncidentIndex {
	return {
		schema_version: 1,
		updated_at: updatedAt,
		// Newest first: a consumer checking "anything new?" reads the top.
		incidents: [...reports]
			.sort((a, b) => b.id.localeCompare(a.id))
			.map((r) => ({
				id: r.id,
				date: r.date,
				title: r.title,
				severity: r.severity,
				affects_archive: r.affects_archive === true,
				path: `reports/incidents/${r.id}.json`,
			})),
	};
}

async function main(): Promise<void> {
	const apply = process.argv.includes("--apply");
	const dir =
		process.env.INCIDENT_REPORT_DIR ?? "/app/docs/incidents/published";

	const reports = await loadReports(dir);
	const index = buildIndex(reports, new Date().toISOString());
	console.log(JSON.stringify(index, null, 2));

	if (!apply) {
		console.error(`\n(dry-run — ${reports.length} reports, pass --apply)`);
		return;
	}

	const config = getStreamsBulkR2ConfigFromEnv();
	const client = createStreamsBulkS3Client(config);
	const privateKey = process.env.STREAMS_SIGNING_PRIVATE_KEY;

	for (const report of reports) {
		const signed = privateKey
			? signStreamsBulkManifest(
					report as unknown as Record<string, unknown>,
					privateKey,
				)
			: report;
		await putJsonObject({
			client,
			bucket: config.bucket,
			key: `${CANONICAL_ARCHIVE_PREFIX}/reports/incidents/${report.id}.json`,
			value: signed,
		});
		console.error(`published ${report.id}`);
	}

	// Index last: it is the thing consumers enumerate, so it should never name
	// a report that is not there yet.
	const signedIndex = privateKey
		? signStreamsBulkManifest(
				index as unknown as Record<string, unknown>,
				privateKey,
			)
		: index;
	await putJsonObject({
		client,
		bucket: config.bucket,
		key: `${CANONICAL_ARCHIVE_PREFIX}/reports/incidents/index.json`,
		value: signedIndex,
	});
	console.error(`published index (${reports.length} incidents)`);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(
			"publish-incidents failed:",
			err instanceof Error ? err.message : err,
		);
		process.exit(1);
	});
}
