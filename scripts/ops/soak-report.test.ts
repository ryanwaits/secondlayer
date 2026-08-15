import { describe, expect, it } from "bun:test";
/**
 * The soak verdict is a pure function over typed events and causes, so every
 * case below runs with no Docker, no journal, and no database — which is the
 * point of the split. The IO shell is exercised only through its parsers,
 * which are pure too (text in, typed records out).
 */
import {
	type RestartEvent,
	type SoakCause,
	type SoakWindow,
	aggregateSoak,
	deriveSnapshotTransitions,
	deriveStageTransitions,
	formatSoakReport,
	parseArgs,
	parseCausesFile,
	parseDeployState,
	parseDockerInspect,
	parseJournalTimerRuns,
	resolveSince,
} from "./soak-report.ts";

const WINDOW: SoakWindow = {
	since: "2026-08-08T00:00:00.000Z",
	until: "2026-08-15T00:00:00.000Z",
};
const GENERATED_AT = "2026-08-15T00:00:05.000Z";

function restart(at: string, container = "secondlayer-api-1"): RestartEvent {
	return {
		kind: "restart",
		at,
		container,
		image: "ghcr.io/secondlayer/app@sha256:abc",
		image_digest: "sha256:abc",
		restart_count: 1,
		exit_code: 0,
		source: "docker",
	};
}

describe("aggregateSoak", () => {
	it("marks a restart that lands on a recorded deploy as explained", () => {
		const deploy: SoakCause = {
			kind: "deploy",
			id: "deploy:9f2a1c",
			at: "2026-08-10T12:00:00.000Z",
			until: null,
			label: "deploy 9f2a1c",
			image_digest: "9f2a1c",
		};

		const report = aggregateSoak({
			window: WINDOW,
			events: [restart("2026-08-10T12:01:30.000Z")],
			causes: [deploy],
			generated_at: GENERATED_AT,
		});

		expect(report.verdict).toBe("pass");
		expect(report.totals).toMatchObject({
			restarts: 1,
			explained: 1,
			unexplained: 0,
		});
		expect(report.restarts[0].explained).toBe(true);
		expect(report.restarts[0].cause).toMatchObject({
			kind: "deploy",
			id: "deploy:9f2a1c",
			distance_seconds: 90,
		});
	});

	it("fails the window on a restart with no cause in reach", () => {
		const deploy: SoakCause = {
			kind: "deploy",
			id: "deploy:9f2a1c",
			at: "2026-08-10T12:00:00.000Z",
			until: null,
			label: "deploy 9f2a1c",
		};

		// Two days after the only deploy, and well outside the 300s tolerance.
		const report = aggregateSoak({
			window: WINDOW,
			events: [restart("2026-08-12T03:14:00.000Z", "secondlayer-indexer-1")],
			causes: [deploy],
			generated_at: GENERATED_AT,
		});

		expect(report.verdict).toBe("fail");
		expect(report.totals.unexplained).toBe(1);
		expect(report.unexplained[0].cause).toBeNull();
		expect(report.unexplained[0].reason).toContain("secondlayer-indexer-1");
	});

	it("explains a coverage transition that falls inside a recorded incident for that stage", () => {
		const incident: SoakCause = {
			kind: "incident",
			id: "stage_failure:decode_ft:0",
			at: "2026-08-11T04:00:00.000Z",
			until: "2026-08-11T06:00:00.000Z",
			label: "decode_ft source_gap failure (open)",
			stages: ["decode_ft"],
		};

		const report = aggregateSoak({
			window: WINDOW,
			events: [
				{
					kind: "coverage_transition",
					at: "2026-08-11T05:00:00.000Z",
					stage_id: "decode_ft",
					from: "complete",
					to: "gap",
					complete_through: 8_700_000,
					source: "stage_runs",
				},
			],
			causes: [incident],
			generated_at: GENERATED_AT,
		});

		expect(report.verdict).toBe("pass");
		expect(report.coverage_transitions[0].explained).toBe(true);
		expect(report.coverage_transitions[0].cause).toMatchObject({
			kind: "incident",
			distance_seconds: 0,
		});
	});

	it("fails on a coverage transition for a stage no recorded cause covers", () => {
		const incident: SoakCause = {
			kind: "incident",
			id: "stage_failure:decode_ft:0",
			at: "2026-08-11T04:00:00.000Z",
			until: "2026-08-11T06:00:00.000Z",
			label: "decode_ft source_gap failure (open)",
			stages: ["decode_ft"],
		};
		// A container-scoped timer run must not launder a coverage transition.
		const timer: SoakCause = {
			kind: "timer_run",
			id: "timer:abc",
			at: "2026-08-11T05:00:00.000Z",
			until: "2026-08-11T05:00:30.000Z",
			label: "secondlayer-archive-status.service",
			containers: ["secondlayer-indexer-1"],
		};

		const report = aggregateSoak({
			window: WINDOW,
			events: [
				{
					kind: "coverage_transition",
					at: "2026-08-11T05:00:00.000Z",
					stage_id: "raw_blocks",
					from: "complete",
					to: "lagging",
					complete_through: 8_699_000,
					source: "stage_runs",
				},
			],
			causes: [incident, timer],
			generated_at: GENERATED_AT,
		});

		expect(report.verdict).toBe("fail");
		expect(report.totals.unexplained).toBe(1);
		expect(report.unexplained[0].reason).toContain("raw_blocks");
	});

	it("passes an empty window and reports zero totals", () => {
		const report = aggregateSoak({
			window: WINDOW,
			events: [],
			causes: [],
			generated_at: GENERATED_AT,
		});

		expect(report.verdict).toBe("pass");
		expect(report.conclusive).toBe(true);
		expect(report.totals).toEqual({
			restarts: 0,
			coverage_transitions: 0,
			explained: 0,
			unexplained: 0,
			causes: 0,
		});
		expect(formatSoakReport(report)).toContain("verdict: PASS");
	});

	it("drops events outside the window and keeps unparseable timestamps as failures", () => {
		const report = aggregateSoak({
			window: WINDOW,
			events: [
				restart("2026-08-01T00:00:00.000Z"),
				restart("2026-08-20T00:00:00.000Z"),
				restart("not-a-timestamp"),
			],
			causes: [],
			generated_at: GENERATED_AT,
		});

		expect(report.totals.restarts).toBe(1);
		expect(report.verdict).toBe("fail");
		expect(report.unexplained[0].reason).toContain("not parseable");
	});

	it("prefers the nearest cause, breaking ties toward a deploy", () => {
		const report = aggregateSoak({
			window: WINDOW,
			events: [restart("2026-08-10T12:00:00.000Z")],
			causes: [
				{
					kind: "timer_run",
					id: "timer:x",
					at: "2026-08-10T12:00:00.000Z",
					until: "2026-08-10T12:00:10.000Z",
					label: "secondlayer-health-alert.service",
				},
				{
					kind: "deploy",
					id: "deploy:1",
					at: "2026-08-10T11:59:55.000Z",
					until: "2026-08-10T12:00:05.000Z",
					label: "deploy 1",
				},
			],
			generated_at: GENERATED_AT,
		});

		expect(report.restarts[0].cause?.kind).toBe("deploy");
	});

	it("marks the window inconclusive when a source could not be read", () => {
		const report = aggregateSoak({
			window: WINDOW,
			events: [],
			causes: [],
			generated_at: GENERATED_AT,
			warnings: ["docker restarts unavailable: docker exited 1"],
		});

		expect(report.verdict).toBe("pass");
		expect(report.conclusive).toBe(false);
		expect(formatSoakReport(report)).toContain("INCONCLUSIVE");
	});
});

describe("coverage history derivation", () => {
	it("emits one transition per stage_runs status change and skips lifecycle statuses", () => {
		const events = deriveStageTransitions(
			[
				// Prior state, before the window — supplies the `from` side.
				{
					stage_id: "raw_blocks",
					status: "complete",
					started_at: "2026-08-01T00:00:00.000Z",
					complete_through: 8_600_000,
				},
				{
					stage_id: "raw_blocks",
					status: "running",
					started_at: "2026-08-09T00:00:00.000Z",
					complete_through: 8_650_000,
				},
				{
					stage_id: "raw_blocks",
					status: "lagging",
					started_at: "2026-08-09T01:00:00.000Z",
					complete_through: 8_650_000,
				},
				{
					stage_id: "raw_blocks",
					status: "lagging",
					started_at: "2026-08-09T02:00:00.000Z",
					complete_through: 8_660_000,
				},
				{
					stage_id: "raw_blocks",
					status: "complete",
					started_at: "2026-08-09T03:00:00.000Z",
					complete_through: 8_670_000,
				},
			],
			WINDOW,
		);

		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			stage_id: "raw_blocks",
			from: "complete",
			to: "lagging",
			source: "stage_runs",
		});
		expect(events[1]).toMatchObject({ from: "lagging", to: "complete" });
	});

	it("derives subgraph states from health snapshot counters", () => {
		const events = deriveSnapshotTransitions(
			[
				{
					subgraph_id: "sg1",
					total_errors: 0,
					last_processed_block: 100,
					captured_at: "2026-08-09T00:00:00.000Z",
				},
				{
					subgraph_id: "sg1",
					total_errors: 0,
					last_processed_block: 200,
					captured_at: "2026-08-09T00:30:00.000Z",
				},
				{
					subgraph_id: "sg1",
					total_errors: 3,
					last_processed_block: 200,
					captured_at: "2026-08-09T01:00:00.000Z",
				},
			],
			WINDOW,
			{ stale_seconds: 1800 },
		);

		expect(events.map((e) => e.to)).toEqual(["syncing", "failed"]);
		expect(events[0].stage_id).toBe("subgraph:sg1");
	});

	it("calls a subgraph stale once its block stops moving past the threshold", () => {
		const events = deriveSnapshotTransitions(
			[
				{
					subgraph_id: "sg1",
					total_errors: 0,
					last_processed_block: 100,
					captured_at: "2026-08-09T00:00:00.000Z",
				},
				{
					subgraph_id: "sg1",
					total_errors: 0,
					last_processed_block: 100,
					captured_at: "2026-08-09T00:10:00.000Z",
				},
				{
					subgraph_id: "sg1",
					total_errors: 0,
					last_processed_block: 100,
					captured_at: "2026-08-09T01:00:00.000Z",
				},
			],
			WINDOW,
			{ stale_seconds: 1800 },
		);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ from: null, to: "stale" });
	});
});

describe("source parsers", () => {
	it("reads container starts out of docker inspect output", () => {
		const events = parseDockerInspect(
			JSON.stringify([
				{
					Name: "/secondlayer-api-1",
					Image: "ghcr.io/secondlayer/app@sha256:deadbeef",
					RestartCount: 2,
					State: { StartedAt: "2026-08-10T12:00:00.000Z", ExitCode: 0 },
				},
			]),
		);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			container: "secondlayer-api-1",
			image_digest: "sha256:deadbeef",
			restart_count: 2,
			source: "docker",
		});
	});

	it("groups journal entries into one timer run per invocation", () => {
		const journal = [
			JSON.stringify({
				_SYSTEMD_UNIT: "secondlayer-archive-publish.service",
				_SYSTEMD_INVOCATION_ID: "inv1",
				__REALTIME_TIMESTAMP: "1786000000000000",
				MESSAGE: "starting",
			}),
			JSON.stringify({
				_SYSTEMD_UNIT: "secondlayer-archive-publish.service",
				_SYSTEMD_INVOCATION_ID: "inv1",
				__REALTIME_TIMESTAMP: "1786000600000000",
				MESSAGE: "done",
			}),
			"{ not json",
		].join("\n");

		const causes = parseJournalTimerRuns(journal);
		expect(causes).toHaveLength(1);
		expect(causes[0]).toMatchObject({
			kind: "timer_run",
			label: "secondlayer-archive-publish.service",
		});
		expect(Date.parse(causes[0].until ?? "") - Date.parse(causes[0].at)).toBe(
			600_000,
		);
	});

	it("turns deploy.sh's last-success.env into a deploy cause", () => {
		const cause = parseDeployState(
			[
				"DEPLOY_IMAGE_OWNER=secondlayer",
				"DEPLOY_IMAGE_TAG=main-9f2a1c",
				"DEPLOY_SHA=9f2a1c",
				"DEPLOY_RECORDED_AT=2026-08-10T12:00:00+00:00",
			].join("\n"),
		);

		expect(cause).toMatchObject({
			kind: "deploy",
			id: "deploy:9f2a1c",
			at: "2026-08-10T12:00:00.000Z",
		});
		expect(parseDeployState("DEPLOY_SHA=9f2a1c")).toBeNull();
	});

	it("rejects operator-recorded causes without a usable timestamp", () => {
		const causes = parseCausesFile(
			JSON.stringify([
				{
					kind: "incident",
					at: "2026-08-11T04:00:00Z",
					until: "2026-08-11T06:00:00Z",
					label: "disk pressure",
					containers: ["secondlayer-indexer-1"],
				},
				{ kind: "incident", label: "no timestamp" },
			]),
		);

		expect(causes).toHaveLength(1);
		expect(causes[0]).toMatchObject({
			kind: "incident",
			label: "disk pressure",
			containers: ["secondlayer-indexer-1"],
		});
	});
});

describe("argument parsing", () => {
	it("resolves relative and absolute window starts", () => {
		const until = new Date("2026-08-15T00:00:00.000Z");
		expect(resolveSince("7d", until)?.toISOString()).toBe(
			"2026-08-08T00:00:00.000Z",
		);
		expect(resolveSince("24h", until)?.toISOString()).toBe(
			"2026-08-14T00:00:00.000Z",
		);
		expect(resolveSince("2026-08-01T00:00:00Z", until)?.toISOString()).toBe(
			"2026-08-01T00:00:00.000Z",
		);
		expect(resolveSince("last tuesday", until)).toBeNull();
	});

	it("defaults to a seven-day window and records flag errors", () => {
		const now = new Date("2026-08-15T00:00:00.000Z");
		const defaults = parseArgs([], now);
		expect(defaults.since).toBe("2026-08-08T00:00:00.000Z");
		expect(defaults.until).toBe("2026-08-15T00:00:00.000Z");
		expect(defaults.json).toBe(false);
		expect(defaults.error).toBeNull();

		const explicit = parseArgs(
			["--since", "24h", "--json", "--tolerance", "60", "--no-db"],
			now,
		);
		expect(explicit.since).toBe("2026-08-14T00:00:00.000Z");
		expect(explicit.json).toBe(true);
		expect(explicit.tolerance_seconds).toBe(60);
		expect(explicit.use_db).toBe(false);

		expect(parseArgs(["--since", "yesterday"], now).error).toContain("--since");
		expect(parseArgs(["--tolerance", "soon"], now).error).toContain(
			"--tolerance",
		);
	});
});
