/**
 * The docs key on a page as one state value and one pure transition. The DOM
 * module (`components/code/use-key.ts`) holds a single `KeyState`, feeds events
 * through `nextKeyState`, and paints from the result.
 *
 * `epoch` counts the times the key was thrown away under a mint (the reader
 * changed, or the key was forgotten). A mint carries the epoch it started in;
 * its result is dropped when the epoch has moved on, so a mint begun for one
 * reader never lands on the next one.
 */

export type DocsKey =
	| { kind: "none" }
	/** A mint is in flight. `after` is where a failed mint goes back to. */
	| { kind: "minting"; epoch: number; after: "none" | "expired" }
	| {
			kind: "held";
			key: string;
			expiresAt: string;
			owner: string;
			revealed: boolean;
	  }
	| { kind: "expired" }
	/** Signed out and already given today's key: the note says this instead. */
	| { kind: "limited"; text: string };

export type PanelMode = "closed" | "about" | "lasting";

export type Panel = {
	mode: PanelMode;
	/** The sign-in link for a lasting key is being sent. */
	sending: boolean;
	error: string | null;
	/** When the panel last closed (ms): a click on the chip light-dismisses it
	 *  first and must not reopen it. */
	closedAt: number;
};

export type KeyState = {
	/** Who the page is read as; null before the first `activate`. */
	owner: string | null;
	epoch: number;
	key: DocsKey;
	panel: Panel;
};

export type KeyEvent =
	| { type: "activate"; owner: string }
	| { type: "mint" }
	| { type: "minted"; epoch: number; key: string; expiresAt: string }
	| { type: "mintLimited"; epoch: number; text: string }
	| { type: "mintFailed"; epoch: number }
	| { type: "adopt"; key: string; expiresAt: string; owner: string }
	| { type: "toggleReveal" }
	| { type: "expire" }
	| { type: "forget" }
	| { type: "panelShow"; mode: "about" | "lasting" }
	| { type: "panelClosed"; at: number }
	| { type: "sendStart" }
	| { type: "sendFailed"; error: string }
	| { type: "sendDone" };

const CLOSED_PANEL = (closedAt: number): Panel => ({
	mode: "closed",
	sending: false,
	error: null,
	closedAt,
});

export const INITIAL_KEY_STATE: KeyState = {
	owner: null,
	epoch: 0,
	key: { kind: "none" },
	panel: CLOSED_PANEL(0),
};

/** Milliseconds until a key stops working; 0 when it already has. */
export function expiryDelay(expiresAt: string, now = Date.now()): number {
	return Math.max(0, Date.parse(expiresAt) - now);
}

/** Whether `state` holds a key that has not expired by `now`. */
export function isLive(state: KeyState, now = Date.now()): boolean {
	return state.key.kind === "held" && expiryDelay(state.key.expiresAt, now) > 0;
}

/** True while the mint for `epoch` is the one the state is waiting on. */
function awaiting(state: KeyState, epoch: number): boolean {
	return state.key.kind === "minting" && state.key.epoch === epoch;
}

/** Throw the key away and orphan any mint in flight. A daily-limit note stays. */
function discard(state: KeyState): KeyState {
	return {
		...state,
		epoch: state.epoch + 1,
		key: state.key.kind === "limited" ? state.key : { kind: "none" },
		panel: CLOSED_PANEL(state.panel.closedAt),
	};
}

export function nextKeyState(state: KeyState, event: KeyEvent): KeyState {
	switch (event.type) {
		case "activate": {
			if (state.owner === null || state.owner === event.owner)
				return { ...state, owner: event.owner };
			// A different reader (sign-out or sign-in, maybe in another tab):
			// nothing of the last reader's carries over, not even a mint.
			return {
				owner: event.owner,
				epoch: state.epoch + 1,
				key: { kind: "none" },
				panel: CLOSED_PANEL(state.panel.closedAt),
			};
		}
		case "mint": {
			const { key } = state;
			if (state.owner === null || key.kind === "minting" || key.kind === "held")
				return state;
			return {
				...state,
				key: {
					kind: "minting",
					epoch: state.epoch,
					after: key.kind === "expired" ? "expired" : "none",
				},
			};
		}
		case "minted": {
			if (!awaiting(state, event.epoch) || state.owner === null) return state;
			return {
				...state,
				key: {
					kind: "held",
					key: event.key,
					expiresAt: event.expiresAt,
					owner: state.owner,
					revealed: false,
				},
			};
		}
		case "mintLimited":
			return awaiting(state, event.epoch)
				? { ...state, key: { kind: "limited", text: event.text } }
				: state;
		case "mintFailed": {
			if (state.key.kind !== "minting" || !awaiting(state, event.epoch))
				return state;
			return { ...state, key: { kind: state.key.after } };
		}
		case "adopt":
			return {
				...state,
				key: {
					kind: "held",
					key: event.key,
					expiresAt: event.expiresAt,
					owner: event.owner,
					revealed: false,
				},
			};
		case "toggleReveal":
			return state.key.kind === "held"
				? { ...state, key: { ...state.key, revealed: !state.key.revealed } }
				: state;
		case "expire":
			return state.key.kind === "held" || state.key.kind === "none"
				? { ...state, key: { kind: "expired" } }
				: state;
		case "forget":
			return discard(state);
		case "panelShow":
			return {
				...state,
				panel: { ...state.panel, mode: event.mode, error: null },
			};
		case "panelClosed":
			return {
				...state,
				panel: { ...state.panel, mode: "closed", closedAt: event.at },
			};
		case "sendStart":
			return state.panel.sending
				? state
				: { ...state, panel: { ...state.panel, sending: true, error: null } };
		case "sendFailed":
			return {
				...state,
				panel: { ...state.panel, sending: false, error: event.error },
			};
		case "sendDone":
			return {
				...state,
				panel: { ...state.panel, sending: false, error: null },
			};
	}
}
