"use client";

import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	createContext,
	useContext,
	useRef,
	useState,
} from "react";
import { ROW_ACTION_WIDTH, dragAxis, rubberband, settleRow } from "./gesture";

export type SwipeAction = {
	label: ReactNode;
	tone: "neutral" | "pri" | "alarm";
	onAction: () => void;
};

type GroupState = {
	openId: string | null;
	setOpenId: (id: string | null) => void;
};

const SwipeContext = createContext<GroupState | null>(null);

/** One open row at a time inside a group (a list). */
export function SwipeGroup({ children }: { children: ReactNode }) {
	const [openId, setOpenId] = useState<string | null>(null);
	return (
		<SwipeContext.Provider value={{ openId, setOpenId }}>
			{children}
		</SwipeContext.Provider>
	);
}

/**
 * A list row that reveals one or two actions when swiped left. Vertical drags
 * stay native scrolling. The action buttons are real buttons, and focusing one
 * opens the row, so the actions are reachable without a gesture.
 */
export function SwipeRow({
	id,
	actions,
	onTap,
	children,
}: {
	id: string;
	/** 1 or 2 actions, revealed on the right by swiping left. */
	actions: readonly SwipeAction[];
	/** Tap on the row face (only when no drag happened and the row is closed). */
	onTap?: () => void;
	children: ReactNode;
}) {
	if (
		process.env.NODE_ENV !== "production" &&
		(actions.length < 1 || actions.length > 2)
	) {
		throw new Error(
			`SwipeRow "${id}" needs 1 or 2 actions, got ${actions.length}`,
		);
	}
	const fallback = useState<string | null>(null);
	const group = useContext(SwipeContext);
	const { openId, setOpenId } = group ?? {
		openId: fallback[0],
		setOpenId: fallback[1],
	};
	const open = openId === id;
	const width = actions.length * ROW_ACTION_WIDTH;
	const faceRef = useRef<HTMLDivElement>(null);
	const gesture = useRef<{
		x0: number;
		y0: number;
		base: number;
		axis: "x" | "y" | null;
		offset: number;
	} | null>(null);
	const dragged = useRef(false);

	const reset = () => {
		const face = faceRef.current;
		if (!face) return;
		face.classList.remove("is-drag");
		face.style.transform = "";
	};

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (e.pointerType === "mouse" && e.button !== 0) return;
		gesture.current = {
			x0: e.clientX,
			y0: e.clientY,
			base: open ? -width : 0,
			axis: null,
			offset: open ? -width : 0,
		};
	};
	const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		const g = gesture.current;
		const face = faceRef.current;
		if (!g || !face || g.axis === "y") return;
		const dx = e.clientX - g.x0;
		if (g.axis === null) {
			g.axis = dragAxis(dx, e.clientY - g.y0);
			if (g.axis === "y") {
				gesture.current = null;
				return;
			}
			if (g.axis === "x") {
				e.currentTarget.setPointerCapture(e.pointerId);
				face.classList.add("is-drag");
			} else return;
		}
		g.offset = rubberband(g.base + dx, -width, 0);
		face.style.transform = `translateX(${g.offset}px)`;
	};
	const finish = (commit: boolean) => {
		const g = gesture.current;
		gesture.current = null;
		if (!g || g.axis !== "x") return;
		// The click that follows a drag is not a tap.
		dragged.current = true;
		setTimeout(() => {
			dragged.current = false;
		}, 0);
		reset();
		if (!commit) return;
		setOpenId(settleRow(g.offset, width) < 0 ? id : null);
	};

	const tap = () => {
		if (dragged.current) return;
		if (open) setOpenId(null);
		else onTap?.();
	};
	const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
		if (e.target !== e.currentTarget) return;
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			tap();
		}
	};

	return (
		<div
			className="m-row"
			style={{ "--acts-w": `${width}px` } as CSSProperties}
		>
			<div className="m-row-acts" style={{ width }}>
				{actions.map((action, i) => (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed, ordered pair
						key={i}
						type="button"
						className={`m-act is-${action.tone}`}
						onFocus={() => setOpenId(id)}
						onClick={() => {
							action.onAction();
							setOpenId(null);
						}}
					>
						{action.label}
					</button>
				))}
			</div>
			<div
				ref={faceRef}
				// biome-ignore lint/a11y/useSemanticElements: the face holds block content a <button> cannot
				role="button"
				tabIndex={0}
				className={`m-row-face${open ? " is-open" : ""}`}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={() => finish(true)}
				onPointerCancel={() => finish(false)}
				onClick={tap}
				onKeyDown={onKeyDown}
			>
				{children}
			</div>
		</div>
	);
}
