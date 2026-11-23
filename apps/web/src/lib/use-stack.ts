"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { type WebhooksResult, initialNotice } from "./dashboard-results";
import {
	type StackNotice,
	WAKE_IDLE,
	noticeFor,
	wakeReducer,
} from "./stack-status";
import { poll } from "./webhooks-store";

export function usePollNotice<T>(opts: {
	initial: WebhooksResult<T> | null | undefined;
	run: () => Promise<WebhooksResult<unknown>>;
	intervalMs: number;
	immediate: boolean;
}): StackNotice | null {
	const { initial, run, intervalMs, immediate } = opts;
	const [notice, setNotice] = useState<StackNotice | null>(
		initial ? initialNotice(initial, noticeFor) : null,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `run` is a stable module function per page; restart only when the first-read verdict changes
	useEffect(
		() =>
			poll(
				async () => {
					const res = await run();
					const next = noticeFor(res);
					if (next !== undefined) setNotice(next);
					return res.kind === "starting" || res.kind === "rate_limited"
						? { retryAfterMs: res.retryAfter * 1000 }
						: {};
				},
				intervalMs,
				{ immediate },
			),
		[immediate, intervalMs],
	);
	return notice;
}

export function useWake(wake: () => Promise<WebhooksResult<unknown>>): {
	waking: boolean;
	error: string | null;
	start: () => void;
} {
	const [state, dispatch] = useReducer(wakeReducer, WAKE_IDLE);
	useEffect(() => {
		if (state.phase !== "waking") return;
		const timer = setInterval(
			() => dispatch({ type: "tick", now: Date.now() }),
			1000,
		);
		return () => clearInterval(timer);
	}, [state.phase]);
	const start = useCallback(() => {
		dispatch({ type: "start", now: Date.now() });
		void wake().then((res) => {
			if (res.kind === "error") {
				dispatch({ type: "error", message: res.message });
			}
		});
	}, [wake]);
	return {
		waking: state.phase === "waking",
		error: state.phase === "failed" ? state.message : null,
		start,
	};
}
