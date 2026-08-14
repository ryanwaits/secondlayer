import type { EvaluatorInput, StageDeclaration } from "./evaluate.ts";

export const NOW = new Date("2026-08-13T12:00:00.000Z");

export function stage(
	overrides: Partial<StageDeclaration> & Pick<StageDeclaration, "id">,
): StageDeclaration {
	return {
		kind: "raw",
		depends_on: null,
		native_clock: "block",
		producer_version: "test",
		repair_mode: "archive_replay",
		enabled: true,
		...overrides,
	};
}

function input(overrides: Partial<EvaluatorInput> = {}): EvaluatorInput {
	return {
		scope: {
			network: "mainnet",
			start_height: 0,
			target_height: 100,
			bootstrap: {
				source: "archive",
				manifest_digest: "abc",
				genesis_hash: "0xgen",
			},
		},
		stages: [stage({ id: "raw" })],
		runs: [
			{
				stage_id: "raw",
				code_hash: "code",
				config_hash: "cfg",
				handler_hash: null,
				target_height: 100,
				target_cursor: null,
				status: "running",
				complete_through: null,
			},
		],
		evidence: [
			{
				stage_id: "raw",
				ranges: [{ from_height: 0, to_height: 100 }],
				open_failures: [],
				cursor: null,
				queue: null,
				unanchored: false,
				unverified_import: false,
				source_available: true,
			},
		],
		source: {
			tip_height: 100,
			finalized_height: 100,
			observed_at: "2026-08-13T12:00:00.000Z",
		},
		options: { now: NOW },
		...overrides,
	};
}

export const CASES = {
	complete: input(),
	lagging: input({
		source: {
			tip_height: 140,
			finalized_height: 100,
			observed_at: "2026-08-13T12:00:00.000Z",
		},
	}),
	stale: input({
		source: {
			tip_height: 10_000,
			finalized_height: 9_000,
			observed_at: "2026-08-13T12:00:00.000Z",
		},
	}),
	"stale-clock": input({
		source: {
			tip_height: 100,
			finalized_height: 100,
			observed_at: "2026-08-13T10:00:00.000Z",
		},
	}),
	gap: input({
		evidence: [
			{
				stage_id: "raw",
				ranges: [
					{ from_height: 0, to_height: 40 },
					{ from_height: 80, to_height: 100 },
				],
				open_failures: [],
				cursor: null,
				queue: null,
				unanchored: false,
				unverified_import: false,
				source_available: true,
			},
		],
	}),
	syncing: input({
		evidence: [
			{
				stage_id: "raw",
				ranges: [{ from_height: 0, to_height: 40 }],
				open_failures: [],
				cursor: null,
				queue: null,
				unanchored: false,
				unverified_import: false,
				source_available: true,
			},
		],
	}),
	failed: input({
		evidence: [
			{
				stage_id: "raw",
				ranges: [{ from_height: 0, to_height: 100 }],
				open_failures: [
					{
						unit_kind: "block",
						class: "crash",
						retry_state: "halted",
						from_height: 77,
						to_height: 77,
					},
				],
				cursor: null,
				queue: null,
				unanchored: false,
				unverified_import: false,
				source_available: true,
			},
		],
	}),
	unverified_import: input({
		evidence: [
			{
				stage_id: "raw",
				ranges: [{ from_height: 0, to_height: 100 }],
				open_failures: [],
				cursor: null,
				queue: null,
				unanchored: false,
				unverified_import: true,
				source_available: true,
			},
		],
	}),
	unanchored: input({
		evidence: [
			{
				stage_id: "raw",
				ranges: [{ from_height: 0, to_height: 100 }],
				open_failures: [],
				cursor: null,
				queue: null,
				unanchored: true,
				unverified_import: false,
				source_available: true,
			},
		],
	}),
	source_unavailable: input({
		scope: {
			network: "mainnet",
			start_height: 0,
			target_height: null,
			bootstrap: {
				source: "genesis",
				manifest_digest: null,
				genesis_hash: "0xgen",
			},
		},
		runs: [
			{
				stage_id: "raw",
				code_hash: "code",
				config_hash: "cfg",
				handler_hash: null,
				target_height: null,
				target_cursor: null,
				status: "running",
				complete_through: null,
			},
		],
		source: {
			tip_height: null,
			finalized_height: null,
			observed_at: null,
		},
	}),
	out_of_scope: input({
		scope: {
			network: "mainnet",
			start_height: 200,
			target_height: 100,
			bootstrap: {
				source: "archive",
				manifest_digest: "abc",
				genesis_hash: "0xgen",
			},
		},
	}),
	disabled: input({
		stages: [stage({ id: "raw", enabled: false })],
	}),
	"dep-cap": input({
		stages: [
			stage({ id: "raw" }),
			stage({
				id: "decode:stx",
				kind: "decode",
				depends_on: "raw",
				repair_mode: "full_reindex",
			}),
		],
		runs: [
			{
				stage_id: "raw",
				code_hash: "code",
				config_hash: "cfg",
				handler_hash: null,
				target_height: 100,
				target_cursor: null,
				status: "running",
				complete_through: null,
			},
			{
				stage_id: "decode:stx",
				code_hash: "code",
				config_hash: "cfg",
				handler_hash: null,
				target_height: 100,
				target_cursor: null,
				status: "running",
				complete_through: null,
			},
		],
		evidence: [
			{
				stage_id: "raw",
				ranges: [{ from_height: 0, to_height: 50 }],
				open_failures: [],
				cursor: null,
				queue: null,
				unanchored: false,
				unverified_import: false,
				source_available: true,
			},
			{
				stage_id: "decode:stx",
				ranges: [{ from_height: 0, to_height: 100 }],
				open_failures: [],
				cursor: null,
				queue: null,
				unanchored: false,
				unverified_import: false,
				source_available: true,
			},
		],
	}),
	"cursor-complete": input({
		stages: [stage({ id: "raw", native_clock: "cursor" })],
		evidence: [
			{
				stage_id: "raw",
				ranges: [],
				open_failures: [],
				cursor: "100:0",
				queue: null,
				unanchored: false,
				unverified_import: false,
				source_available: true,
			},
		],
	}),
	"queue-syncing": input({
		stages: [stage({ id: "deliver", kind: "queue", native_clock: "queue" })],
		runs: [
			{
				stage_id: "deliver",
				code_hash: "code",
				config_hash: "cfg",
				handler_hash: null,
				target_height: 100,
				target_cursor: null,
				status: "running",
				complete_through: null,
			},
		],
		evidence: [
			{
				stage_id: "deliver",
				ranges: [{ from_height: 0, to_height: 100 }],
				open_failures: [],
				cursor: null,
				queue: {
					accepted: 10,
					decided: 10,
					enqueued: 10,
					delivered: 4,
					dead: 0,
					fence_cursor: "100:0",
				},
				unanchored: false,
				unverified_import: false,
				source_available: true,
			},
		],
	}),
	"queue-complete": input({
		stages: [stage({ id: "deliver", kind: "queue", native_clock: "queue" })],
		runs: [
			{
				stage_id: "deliver",
				code_hash: "code",
				config_hash: "cfg",
				handler_hash: null,
				target_height: 100,
				target_cursor: null,
				status: "running",
				complete_through: null,
			},
		],
		evidence: [
			{
				stage_id: "deliver",
				ranges: [],
				open_failures: [],
				cursor: null,
				queue: {
					accepted: 10,
					decided: 10,
					enqueued: 10,
					delivered: 10,
					dead: 0,
					fence_cursor: "100:0",
				},
				unanchored: false,
				unverified_import: false,
				source_available: true,
			},
		],
	}),
	cycle: input({
		stages: [
			stage({ id: "a", depends_on: "b" }),
			stage({ id: "b", depends_on: "a" }),
		],
		runs: [],
		evidence: [],
	}),
	"missing-dep": input({
		stages: [stage({ id: "decode:stx", kind: "decode", depends_on: "raw" })],
		runs: [],
		evidence: [],
	}),
	"complete-not-caught-up": input({
		scope: {
			network: "mainnet",
			start_height: 0,
			target_height: 100,
			bootstrap: {
				source: "archive",
				manifest_digest: "abc",
				genesis_hash: "0xgen",
			},
		},
		source: {
			tip_height: 200,
			finalized_height: 200,
			observed_at: "2026-08-13T12:00:00.000Z",
		},
		options: { now: NOW, maxBlocksBehindFinalized: 10_000 },
	}),
} satisfies Record<string, EvaluatorInput>;
