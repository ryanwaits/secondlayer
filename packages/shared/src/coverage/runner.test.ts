import { describe, expect, test } from "bun:test";
import {
	DEFAULT_MAX_RETRIES,
	RUNNER_EVENT_TYPES,
	RUNNER_STATUSES,
	RUNNER_TRANSITION_TABLE,
	type RunnerEvent,
	type RunnerEventType,
	type RunnerState,
	type RunnerStatus,
	applyRunnerEvent,
	createRunnerState,
	expectedAckHeight,
	lookupTransition,
	versionsEqual,
} from "./runner.ts";

const VERSION = {
	code_hash: "code-a",
	config_hash: "cfg-a",
	handler_hash: null,
};

function pending(): RunnerState {
	return createRunnerState({
		stage_id: "raw",
		start_height: 10,
		target_height: 12,
		version: VERSION,
	});
}

function running(through: number | null = null): RunnerState {
	const started = applyRunnerEvent(pending(), { type: "start" });
	if (!started.ok) throw new Error(started.reason);
	if (through === null) return started.state;
	let state = started.state;
	for (let height = 10; height <= through; height++) {
		const result = applyRunnerEvent(state, ack(height));
		if (!result.ok) throw new Error(result.reason);
		state = result.state;
	}
	return state;
}

function ack(
	height: number,
	hash = `0x${height}`,
): Extract<RunnerEvent, { type: "ack" }> {
	return {
		type: "ack",
		height,
		hash,
		input_count: 0,
		input_digest: "i",
		effect_digest: "e",
	};
}

function fail(): Extract<RunnerEvent, { type: "fail" }> {
	return {
		type: "fail",
		unit_kind: "block",
		class: "crash",
		from_height: 10,
		to_height: 10,
		error: "boom",
	};
}

/** Canonical payload so the table walk can fire every event type. */
function sample(type: RunnerEventType): RunnerEvent {
	switch (type) {
		case "start":
			return { type };
		case "ack":
			return ack(10);
		case "fail":
			return fail();
		case "retry":
			return { type };
		case "halt":
			return { type };
		case "resume":
			return { type };
		case "reorg":
			return { type, fork_point: 10 };
		case "version":
			return { type, version: { ...VERSION, code_hash: "code-b" } };
		case "finish":
			return { type };
	}
}

function seed(status: RunnerStatus): RunnerState {
	if (status === "pending") return pending();
	if (status === "running") return running();
	if (status === "complete") {
		const finished = applyRunnerEvent(running(12), { type: "finish" });
		if (!finished.ok) throw new Error(finished.reason);
		return finished.state;
	}
	if (status === "failed") {
		const failed = applyRunnerEvent(running(), fail());
		if (!failed.ok) throw new Error(failed.reason);
		return failed.state;
	}
	const halted = applyRunnerEvent(running(), { type: "halt" });
	if (!halted.ok) throw new Error(halted.reason);
	return halted.state;
}

describe("transition table", () => {
	test("covers every status × event exactly once", () => {
		const seen = new Set<string>();
		for (const rule of RUNNER_TRANSITION_TABLE) {
			const key = `${rule.from}:${rule.event}`;
			expect(seen.has(key)).toBe(false);
			seen.add(key);
			expect(lookupTransition(rule.from, rule.event)).toEqual(rule);
		}
		expect(seen.size).toBe(RUNNER_STATUSES.length * RUNNER_EVENT_TYPES.length);
		for (const from of RUNNER_STATUSES) {
			for (const event of RUNNER_EVENT_TYPES) {
				expect(seen.has(`${from}:${event}`)).toBe(true);
			}
		}
	});

	test("apply matches the table for every structural pair", () => {
		for (const from of RUNNER_STATUSES) {
			for (const event of RUNNER_EVENT_TYPES) {
				const rule = lookupTransition(from, event);
				const result = applyRunnerEvent(seed(from), sample(event));
				if (rule.to === "reject") {
					expect(result.ok).toBe(false);
					if (!result.ok) expect(result.state.status).toBe(from);
					continue;
				}
				// Guards can still reject a structurally allowed event.
				if (!result.ok) continue;
				expect(result.state.status).toBe(rule.to);
			}
		}
	});
});

describe("ordered acknowledgement", () => {
	test("first ack must be start_height", () => {
		const started = running();
		expect(expectedAckHeight(started)).toBe(10);
		const skip = applyRunnerEvent(started, ack(11));
		expect(skip.ok).toBe(false);
		const first = applyRunnerEvent(started, ack(10));
		expect(first.ok).toBe(true);
		if (first.ok) expect(first.state.complete_through).toBe(10);
	});

	test("acks must be consecutive; empty blocks still count", () => {
		const first = applyRunnerEvent(running(), ack(10));
		if (!first.ok) throw new Error(first.reason);
		const skip = applyRunnerEvent(first.state, ack(12));
		expect(skip.ok).toBe(false);
		const next = applyRunnerEvent(first.state, ack(11));
		expect(next.ok).toBe(true);
	});

	test("duplicate ack of the same height and hash is idempotent", () => {
		const first = applyRunnerEvent(running(), ack(10));
		if (!first.ok) throw new Error(first.reason);
		const again = applyRunnerEvent(first.state, ack(10));
		expect(again.ok).toBe(true);
		if (again.ok) {
			expect(again.state).toEqual(first.state);
			expect(again.effects).toEqual([]);
		}
	});

	test("same height with a new hash is refused until a reorg", () => {
		const first = applyRunnerEvent(running(), ack(10));
		if (!first.ok) throw new Error(first.reason);
		const clash = applyRunnerEvent(first.state, ack(10, "0xother"));
		expect(clash.ok).toBe(false);
		if (!clash.ok) expect(clash.reason).toContain("reorg first");
	});
});

describe("retry and halt", () => {
	test("fail opens a failure; retry returns to running", () => {
		const failed = applyRunnerEvent(running(), fail());
		expect(failed.ok).toBe(true);
		if (!failed.ok) return;
		expect(failed.state.status).toBe("failed");
		expect(failed.effects[0]?.type).toBe("open_failure");
		const retried = applyRunnerEvent(failed.state, { type: "retry" });
		expect(retried.ok).toBe(true);
		if (!retried.ok) return;
		expect(retried.state.status).toBe("running");
		expect(retried.state.retry_count).toBe(1);
		expect(retried.state.open_failure?.retry_state).toBe("retrying");
	});

	test("retry past the budget halts", () => {
		let state = running();
		for (let i = 0; i < DEFAULT_MAX_RETRIES; i++) {
			const failed = applyRunnerEvent(state, fail());
			if (!failed.ok) throw new Error(failed.reason);
			const retried = applyRunnerEvent(failed.state, { type: "retry" });
			if (!retried.ok) throw new Error(retried.reason);
			state = retried.state;
		}
		const failed = applyRunnerEvent(state, fail());
		if (!failed.ok) throw new Error(failed.reason);
		const halted = applyRunnerEvent(failed.state, { type: "retry" });
		expect(halted.ok).toBe(true);
		if (halted.ok) expect(halted.state.status).toBe("halted");
	});

	test("halt from running; resume without a failure does not burn a retry", () => {
		const halted = applyRunnerEvent(running(), { type: "halt" });
		if (!halted.ok) throw new Error(halted.reason);
		expect(halted.state.status).toBe("halted");
		const resumed = applyRunnerEvent(halted.state, { type: "resume" });
		expect(resumed.ok).toBe(true);
		if (resumed.ok) {
			expect(resumed.state.status).toBe("running");
			expect(resumed.state.retry_count).toBe(0);
		}
	});

	test("a successful ack of the failed height resolves it", () => {
		const failed = applyRunnerEvent(running(), fail());
		if (!failed.ok) throw new Error(failed.reason);
		const retried = applyRunnerEvent(failed.state, { type: "retry" });
		if (!retried.ok) throw new Error(retried.reason);
		const acked = applyRunnerEvent(retried.state, ack(10));
		expect(acked.ok).toBe(true);
		if (acked.ok) {
			expect(acked.state.open_failure).toBeNull();
			expect(acked.effects).toEqual([{ type: "resolve_failure" }]);
		}
	});
});

describe("versioning", () => {
	test("same hashes are a no-op", () => {
		const state = running();
		const result = applyRunnerEvent(state, {
			type: "version",
			version: VERSION,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state).toEqual(state);
			expect(result.effects).toEqual([]);
		}
	});

	test("a new version on a live run halts it and asks for a spawn", () => {
		const result = applyRunnerEvent(running(10), {
			type: "version",
			version: { ...VERSION, code_hash: "code-b" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.status).toBe("halted");
			expect(result.state.complete_through).toBe(10);
			expect(result.effects).toEqual([
				{
					type: "spawn_run",
					version: { ...VERSION, code_hash: "code-b" },
				},
			]);
		}
	});

	test("a new version on a complete run keeps it complete", () => {
		const done = seed("complete");
		const result = applyRunnerEvent(done, {
			type: "version",
			version: { ...VERSION, handler_hash: "h2" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.status).toBe("complete");
			expect(result.effects[0]?.type).toBe("spawn_run");
		}
	});

	test("pending can retarget its version in place", () => {
		const next = { ...VERSION, config_hash: "cfg-b" };
		const result = applyRunnerEvent(pending(), {
			type: "version",
			version: next,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state.status).toBe("pending");
			expect(versionsEqual(result.state.version, next)).toBe(true);
			expect(result.effects).toEqual([]);
		}
	});
});

describe("resume", () => {
	test("a crash mid-run resumes at the next height", () => {
		const state = running(10);
		expect(state.status).toBe("running");
		expect(expectedAckHeight(state)).toBe(11);
		const resumed = applyRunnerEvent(state, { type: "resume" });
		expect(resumed.ok).toBe(true);
		if (resumed.ok) {
			expect(resumed.state.complete_through).toBe(10);
			expect(expectedAckHeight(resumed.state)).toBe(11);
		}
	});
});

describe("reorg invalidation", () => {
	test("invalidates overlapping receipts and rewinds before replacement", () => {
		const state = running(12);
		const result = applyRunnerEvent(state, { type: "reorg", fork_point: 11 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.state.status).toBe("running");
		expect(result.state.complete_through).toBe(10);
		expect(result.state.last_acked_hash).toBeNull();
		expect(result.effects).toEqual([
			{
				type: "invalidate_receipts",
				range: { from_height: 11, to_height: 12 },
			},
		]);
		const replacement = applyRunnerEvent(result.state, ack(11, "0xnew"));
		expect(replacement.ok).toBe(true);
	});

	test("a complete run returns to running after a reorg", () => {
		const result = applyRunnerEvent(seed("complete"), {
			type: "reorg",
			fork_point: 11,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.state.status).toBe("running");
	});

	test("a reorg above complete_through is a no-op", () => {
		const state = running(10);
		const result = applyRunnerEvent(state, { type: "reorg", fork_point: 20 });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.state).toEqual(state);
			expect(result.effects).toEqual([]);
		}
	});

	test("a fork below start is refused", () => {
		const result = applyRunnerEvent(running(10), {
			type: "reorg",
			fork_point: 0,
		});
		expect(result.ok).toBe(false);
	});
});

describe("finish", () => {
	test("seals only once every unit through the target is acked", () => {
		const early = applyRunnerEvent(running(11), { type: "finish" });
		expect(early.ok).toBe(false);
		const done = applyRunnerEvent(running(12), { type: "finish" });
		expect(done.ok).toBe(true);
		if (done.ok) expect(done.state.status).toBe("complete");
	});

	test("a follow-the-chain run cannot finish", () => {
		const follow = applyRunnerEvent(
			createRunnerState({
				stage_id: "raw",
				start_height: 0,
				target_height: null,
				version: VERSION,
			}),
			{ type: "start" },
		);
		if (!follow.ok) throw new Error(follow.reason);
		const acked = applyRunnerEvent(follow.state, ack(0, "0x0"));
		if (!acked.ok) throw new Error(acked.reason);
		expect(applyRunnerEvent(acked.state, { type: "finish" }).ok).toBe(false);
	});
});
