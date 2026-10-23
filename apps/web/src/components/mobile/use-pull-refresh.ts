"use client";

import { useEffect, useRef, useState } from "react";
import { PULL_REFRESH_DY, dragAxis } from "./gesture";

/** The pull is dampened to half the finger's travel, and stops here. */
const DAMPEN = 0.5;
const MAX_PULL = 90;

export type PullPhase = "idle" | "pull" | "ready" | "busy";

/** Page-level pull-to-refresh: a downward drag from the very top of the page. */
export function usePullRefresh(onRefresh: () => Promise<unknown>): {
	phase: PullPhase;
	/** Indicator height in px; 0 under reduced motion, where only the text shows. */
	offset: number;
} {
	const [state, setState] = useState<{ phase: PullPhase; offset: number }>({
		phase: "idle",
		offset: 0,
	});
	const refresh = useRef(onRefresh);
	refresh.current = onRefresh;

	useEffect(() => {
		let start: { x: number; y: number; axis: "x" | "y" | null } | null = null;
		let busy = false;
		let pulling = false;
		let ready = false;

		const reduced = () =>
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const atTop = () => (document.scrollingElement?.scrollTop ?? 1) <= 0;
		const inSheet = (target: EventTarget | null) =>
			target instanceof Element && target.closest('[role="dialog"]') !== null;

		const begin = (x: number, y: number, target: EventTarget | null) => {
			if (busy || !atTop() || inSheet(target)) return;
			start = { x, y, axis: null };
		};
		/** Returns true when the drag is a pull the page should not also scroll for. */
		const move = (x: number, y: number): boolean => {
			if (!start || busy) return false;
			const dy = y - start.y;
			if (start.axis === null) {
				start.axis = dragAxis(x - start.x, dy);
				if (start.axis === null) return false;
			}
			if (start.axis === "x" || dy <= 0) {
				if (!pulling) start = null;
				return false;
			}
			pulling = true;
			ready = dy > PULL_REFRESH_DY;
			const offset = Math.min(MAX_PULL, dy * DAMPEN);
			setState({
				phase: ready ? "ready" : "pull",
				offset: reduced() ? 0 : offset,
			});
			return true;
		};
		const end = async () => {
			const refreshNow = pulling && ready;
			const wasPulling = pulling;
			start = null;
			pulling = false;
			ready = false;
			if (!wasPulling) return;
			if (!refreshNow) {
				setState({ phase: "idle", offset: 0 });
				return;
			}
			busy = true;
			setState({ phase: "busy", offset: reduced() ? 0 : PULL_REFRESH_DY / 2 });
			try {
				await refresh.current();
			} finally {
				busy = false;
				setState({ phase: "idle", offset: 0 });
			}
		};

		const touchStart = (e: TouchEvent) => {
			const t = e.touches[0];
			if (t) begin(t.clientX, t.clientY, e.target);
		};
		const touchMove = (e: TouchEvent) => {
			const t = e.touches[0];
			if (t && move(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
		};
		const pointerDown = (e: PointerEvent) => {
			if (e.pointerType === "mouse" && e.button === 0) {
				begin(e.clientX, e.clientY, e.target);
			}
		};
		const pointerMove = (e: PointerEvent) => {
			if (e.pointerType === "mouse") move(e.clientX, e.clientY);
		};
		const pointerUp = (e: PointerEvent) => {
			if (e.pointerType === "mouse") void end();
		};
		const cancel = () => {
			start = null;
			pulling = false;
			if (!busy) setState({ phase: "idle", offset: 0 });
		};

		document.addEventListener("touchstart", touchStart, { passive: true });
		document.addEventListener("touchmove", touchMove, { passive: false });
		document.addEventListener("touchend", end);
		document.addEventListener("touchcancel", cancel);
		document.addEventListener("pointerdown", pointerDown);
		document.addEventListener("pointermove", pointerMove);
		document.addEventListener("pointerup", pointerUp);
		return () => {
			document.removeEventListener("touchstart", touchStart);
			document.removeEventListener("touchmove", touchMove);
			document.removeEventListener("touchend", end);
			document.removeEventListener("touchcancel", cancel);
			document.removeEventListener("pointerdown", pointerDown);
			document.removeEventListener("pointermove", pointerMove);
			document.removeEventListener("pointerup", pointerUp);
		};
	}, []);

	return state;
}
