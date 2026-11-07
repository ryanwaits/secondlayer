"use client";

import { useCallback, useReducer, useRef } from "react";

/**
 * An optimistic save as a state machine. `seq` numbers the saves of one
 * setting: only the newest one's answer is heard, so a slow earlier response
 * can never undo or confirm a later tap.
 */
export type SaveState<T> = { seq: number } & (
	| { status: "idle" }
	| { status: "saving"; next: T }
	| { status: "failed"; error: string }
);

export type SaveEvent<T> =
	| { type: "start"; seq: number; next: T }
	| { type: "done"; seq: number }
	| { type: "fail"; seq: number; error: string };

export const SAVE_IDLE = { seq: 0, status: "idle" } as const;

export function saveReducer<T>(
	state: SaveState<T>,
	event: SaveEvent<T>,
): SaveState<T> {
	switch (event.type) {
		case "start":
			// Saves are numbered in order; an out-of-order start is ignored.
			return event.seq > state.seq
				? { seq: event.seq, status: "saving", next: event.next }
				: state;
		case "done":
			return event.seq === state.seq && state.status === "saving"
				? { seq: state.seq, status: "idle" }
				: state;
		case "fail":
			return event.seq === state.seq && state.status === "saving"
				? { seq: state.seq, status: "failed", error: event.error }
				: state;
	}
}

/** The value to show while a save is out, else undefined (show what is stored). */
export function pendingValue<T>(
	state: SaveState<T> | undefined,
): T | undefined {
	return state?.status === "saving" ? state.next : undefined;
}

/** What `run` says happened. `stale` means a newer save of the same setting superseded it. */
export type SaveResult = "saved" | "failed" | "stale";

type Keyed<K extends string, T> = Partial<Record<K, SaveState<T>>>;

function keyedReducer<K extends string, T>(
	state: Keyed<K, T>,
	action: { key: K; event: SaveEvent<T> },
): Keyed<K, T> {
	const prev = state[action.key] ?? (SAVE_IDLE as SaveState<T>);
	const next = saveReducer(prev, action.event);
	return next === prev ? state : { ...state, [action.key]: next };
}

/**
 * Saves for several settings at once, each with its own pending value and its
 * own sequence. `write` resolves to null (or throws) when the save failed.
 */
export function useSaves<K extends string, T>(
	write: (key: K, next: T) => Promise<unknown>,
) {
	const [saves, dispatch] = useReducer(
		keyedReducer as (
			s: Keyed<K, T>,
			a: { key: K; event: SaveEvent<T> },
		) => Keyed<K, T>,
		{},
	);
	const seqs = useRef<Partial<Record<K, number>>>({});

	const run = useCallback(
		async (key: K, next: T): Promise<SaveResult> => {
			const seq = (seqs.current[key] ?? 0) + 1;
			seqs.current[key] = seq;
			dispatch({ key, event: { type: "start", seq, next } });
			let error: string | null = null;
			try {
				if ((await write(key, next)) === null) error = "Couldn't save";
			} catch (e) {
				error = e instanceof Error ? e.message : "Couldn't save";
			}
			if (seqs.current[key] !== seq) return "stale";
			dispatch({
				key,
				event:
					error === null ? { type: "done", seq } : { type: "fail", seq, error },
			});
			return error === null ? "saved" : "failed";
		},
		[write],
	);

	return { saves, run, pending: (key: K) => pendingValue(saves[key]) };
}

/** One setting's save: `useSaves` with a single key. */
export function useSave<T>(write: (next: T) => Promise<unknown>) {
	const writeOne = useCallback(
		(_key: "value", next: T) => write(next),
		[write],
	);
	const { run, pending } = useSaves<"value", T>(writeOne);
	return {
		pending: pending("value"),
		run: (next: T) => run("value", next),
	};
}
