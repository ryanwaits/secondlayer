import { describe, expect, test } from "bun:test";
import {
	KEY_FLOW_IDLE,
	KEY_FLOW_NAMING,
	type KeyFlow,
	type KeyFlowEvent,
	keyActionsBlocked,
	keyFlowReducer,
} from "./key-flow";

const run = (events: KeyFlowEvent[], from: KeyFlow = KEY_FLOW_IDLE) =>
	events.reduce(keyFlowReducer, from);

const revealed = (events: KeyFlowEvent[] = []) =>
	run([
		{ type: "open" },
		{ type: "submit", name: "laptop" },
		{ type: "created", key: "sk-sl_a", name: "laptop" },
		...events,
	]);

describe("key flow", () => {
	test("naming, submitting and the reveal run in order", () => {
		const flow = revealed();
		expect(flow).toMatchObject({
			step: "revealed",
			key: "sk-sl_a",
			name: "laptop",
			source: "created",
			copied: false,
		});
	});

	test("events that don't fit the current step are ignored", () => {
		expect(run([{ type: "created", key: "k", name: "n" }])).toBe(KEY_FLOW_IDLE);
		expect(run([{ type: "copied" }])).toBe(KEY_FLOW_IDLE);
		expect(run([{ type: "submit", name: "ci" }])).toBe(KEY_FLOW_IDLE);
		expect(run([{ type: "close" }])).toBe(KEY_FLOW_IDLE);
		expect(run([{ type: "failed", error: "x" }])).toBe(KEY_FLOW_IDLE);
	});

	test("a blank name never leaves the naming step", () => {
		expect(run([{ type: "submit", name: "   " }], KEY_FLOW_NAMING)).toBe(
			KEY_FLOW_NAMING,
		);
	});

	test("a refused creation returns to naming with the reason", () => {
		const flow = run([
			{ type: "open" },
			{ type: "submit", name: "ci" },
			{ type: "failed", error: "You have 50 keys." },
		]);
		expect(flow).toEqual({ step: "naming", error: "You have 50 keys." });
	});

	test("closing an uncopied key is refused with a warning; close anyway leaves", () => {
		const warned = revealed([{ type: "close" }]);
		expect(warned).toMatchObject({ step: "revealed", warned: true });
		expect(keyFlowReducer(warned, { type: "close", force: true })).toBe(
			KEY_FLOW_IDLE,
		);
	});

	test("a copied key closes freely", () => {
		expect(revealed([{ type: "copied" }, { type: "close" }])).toBe(
			KEY_FLOW_IDLE,
		);
	});

	test("a rotated key arriving over an uncopied key waits instead of replacing it", () => {
		const flow = revealed([{ type: "rotated", key: "sk-sl_b", name: "ci" }]);
		expect(flow).toMatchObject({ step: "revealed", key: "sk-sl_a" });
		const next = keyFlowReducer(flow, { type: "close", force: true });
		expect(next).toMatchObject({
			step: "revealed",
			key: "sk-sl_b",
			source: "rotated",
			copied: false,
		});
	});

	test("a rotated key arriving mid-create is shown after the created key", () => {
		const submitting = run([
			{ type: "open" },
			{ type: "submit", name: "laptop" },
			{ type: "rotated", key: "sk-sl_b", name: "ci" },
		]);
		expect(submitting.step).toBe("submitting");
		const flow = keyFlowReducer(submitting, {
			type: "created",
			key: "sk-sl_a",
			name: "laptop",
		});
		expect(flow).toMatchObject({ key: "sk-sl_a" });
		expect(
			keyFlowReducer(keyFlowReducer(flow, { type: "copied" }), {
				type: "close",
			}),
		).toMatchObject({ key: "sk-sl_b" });
	});

	test("a rotated key arriving mid-create that then fails is still shown", () => {
		const flow = run([
			{ type: "open" },
			{ type: "submit", name: "laptop" },
			{ type: "rotated", key: "sk-sl_b", name: "ci" },
			{ type: "failed", error: "nope" },
		]);
		expect(flow).toMatchObject({ step: "revealed", key: "sk-sl_b" });
	});

	test("a rotation over a naming form or an idle screen opens the reveal", () => {
		expect(
			run([{ type: "rotated", key: "k", name: "n" }], KEY_FLOW_NAMING),
		).toMatchObject({ step: "revealed", source: "rotated" });
		expect(run([{ type: "rotated", key: "k", name: "n" }])).toMatchObject({
			step: "revealed",
		});
	});

	test("New key reopens naming only once the last key is copied", () => {
		const uncopied = revealed();
		expect(keyFlowReducer(uncopied, { type: "open" })).toBe(uncopied);
		const copied = keyFlowReducer(uncopied, { type: "copied" });
		expect(keyFlowReducer(copied, { type: "open" })).toBe(KEY_FLOW_NAMING);
	});

	test("rotate and create are blocked while a key is unseen or being made", () => {
		expect(keyActionsBlocked(KEY_FLOW_IDLE)).toBe(false);
		expect(keyActionsBlocked(KEY_FLOW_NAMING)).toBe(false);
		expect(
			keyActionsBlocked(run([{ type: "submit", name: "a" }], KEY_FLOW_NAMING)),
		).toBe(true);
		expect(keyActionsBlocked(revealed())).toBe(true);
		expect(keyActionsBlocked(revealed([{ type: "copied" }]))).toBe(false);
	});

	test("warn only marks an uncopied reveal", () => {
		expect(revealed([{ type: "warn" }])).toMatchObject({ warned: true });
		const copied = revealed([{ type: "copied" }]);
		expect(keyFlowReducer(copied, { type: "warn" })).toBe(copied);
	});
});
