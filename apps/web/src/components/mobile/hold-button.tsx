"use client";

import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { HOLD_MS } from "./gesture";

/**
 * A destructive action that fires only after being held: a fill sweeps left to
 * right, the label changes while held, and releasing early cancels. Works with
 * pointer and with Enter or Space.
 */
export function HoldButton({
	label,
	holdingLabel = "Keep holding…",
	onConfirm,
	durationMs = HOLD_MS,
	disabled,
}: {
	/** "Hold to revoke ci-runner" */
	label: string;
	holdingLabel?: string;
	onConfirm: () => void;
	durationMs?: number;
	disabled?: boolean;
}) {
	const hintId = useId();
	const seconds = Math.round(durationMs / 100) / 10;
	const [holding, setHolding] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const onConfirmRef = useRef(onConfirm);
	onConfirmRef.current = onConfirm;

	const cancel = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		setHolding(false);
	};
	const start = () => {
		if (disabled || timer.current) return;
		setHolding(true);
		timer.current = setTimeout(() => {
			timer.current = null;
			setHolding(false);
			try {
				navigator.vibrate?.(18);
			} catch {}
			onConfirmRef.current();
		}, durationMs);
	};
	// Unmounting mid-hold must not confirm.
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	return (
		<>
			<button
				type="button"
				className={`m-hold${holding ? " is-holding" : ""}`}
				style={{ "--hold-ms": `${durationMs}ms` } as CSSProperties}
				aria-describedby={hintId}
				disabled={disabled}
				onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
					if (e.button === 0) start();
				}}
				onPointerUp={cancel}
				onPointerLeave={cancel}
				onPointerCancel={cancel}
				onKeyDown={(e: ReactKeyboardEvent<HTMLButtonElement>) => {
					if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
						e.preventDefault();
						start();
					}
				}}
				onKeyUp={cancel}
				onBlur={cancel}
				onContextMenu={(e) => e.preventDefault()}
			>
				<span>{holding ? holdingLabel : label}</span>
			</button>
			<span id={hintId} className="m-sr">
				{`Press and hold for ${seconds} ${seconds === 1 ? "second" : "seconds"} to confirm.`}
			</span>
		</>
	);
}
