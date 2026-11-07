/**
 * The New key / Rotate lifecycle as one reducer. A key's value is shown once,
 * so nothing may unmount or replace the reveal until the key is copied (or the
 * reader chooses to close anyway). A key that arrives while another is still
 * unseen waits its turn instead of replacing it.
 */

export interface RevealedKey {
	key: string;
	name: string;
}

export type KeyFlow =
	| { step: "idle" }
	| { step: "naming"; error: string | null }
	| { step: "submitting"; name: string; waiting: readonly RevealedKey[] }
	| {
			step: "revealed";
			key: string;
			name: string;
			/** Where the key came from: Create key, or Rotate on a row. */
			source: "created" | "rotated";
			/** The clipboard write resolved. Never true on a rejected write. */
			copied: boolean;
			/** The reader tried to leave or start another key without copying. */
			warned: boolean;
			waiting: readonly RevealedKey[];
	  };

export type KeyFlowEvent =
	| { type: "open" }
	| { type: "submit"; name: string }
	| { type: "created"; key: string; name: string }
	| { type: "failed"; error: string }
	| { type: "rotated"; key: string; name: string }
	| { type: "copied" }
	| { type: "warn" }
	| { type: "close"; force?: boolean };

export const KEY_FLOW_IDLE: KeyFlow = { step: "idle" };
export const KEY_FLOW_NAMING: KeyFlow = { step: "naming", error: null };

const reveal = (
	next: RevealedKey,
	source: "created" | "rotated",
	waiting: readonly RevealedKey[],
): KeyFlow => ({
	step: "revealed",
	key: next.key,
	name: next.name,
	source,
	copied: false,
	warned: false,
	waiting,
});

/** True while a key is on screen that has not been copied, or being made. */
export function keyActionsBlocked(flow: KeyFlow): boolean {
	return (
		flow.step === "submitting" || (flow.step === "revealed" && !flow.copied)
	);
}

/** The flow takes over the space where New key was. */
export function keyFlowOpen(flow: KeyFlow): boolean {
	return flow.step !== "idle";
}

export function keyFlowReducer(flow: KeyFlow, event: KeyFlowEvent): KeyFlow {
	switch (event.type) {
		case "open":
			if (flow.step === "idle" || (flow.step === "revealed" && flow.copied)) {
				return KEY_FLOW_NAMING;
			}
			return flow;
		case "submit":
			if (flow.step !== "naming" || !event.name.trim()) return flow;
			return { step: "submitting", name: event.name.trim(), waiting: [] };
		case "created":
			if (flow.step !== "submitting") return flow;
			return reveal(event, "created", flow.waiting);
		case "failed":
			if (flow.step !== "submitting") return flow;
			// A rotated key that landed mid-request still has to be shown.
			return flow.waiting.length > 0
				? reveal(flow.waiting[0], "rotated", flow.waiting.slice(1))
				: { step: "naming", error: event.error };
		case "rotated": {
			const next = { key: event.key, name: event.name };
			if (flow.step === "submitting") {
				return { ...flow, waiting: [...flow.waiting, next] };
			}
			if (flow.step === "revealed" && !flow.copied) {
				return { ...flow, waiting: [...flow.waiting, next] };
			}
			return reveal(next, "rotated", []);
		}
		case "copied":
			return flow.step === "revealed" ? { ...flow, copied: true } : flow;
		case "warn":
			return flow.step === "revealed" && !flow.copied
				? { ...flow, warned: true }
				: flow;
		case "close": {
			if (flow.step === "naming") return KEY_FLOW_IDLE;
			if (flow.step !== "revealed") return flow;
			if (!flow.copied && !event.force) return { ...flow, warned: true };
			const [next, ...rest] = flow.waiting;
			return next ? reveal(next, "rotated", rest) : KEY_FLOW_IDLE;
		}
	}
}
