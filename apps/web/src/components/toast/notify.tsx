"use client";

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

export type ToastKind = "done" | "ok" | "fail" | "busy";

export interface ToastOptions {
	desc?: ReactNode;
	/** Shows "Undo ⌘Z"; ⌘Z runs it while this is the newest undoable toast. */
	undo?: () => unknown;
	/** Shows "Retry". */
	retry?: () => unknown;
	/** Any other single action. */
	action?: { label: string; run: () => void };
	/** Reuse an id to replace a toast (busy to result). */
	id?: string | number;
	/** Short-lived: copy confirmations, simple saves. */
	quick?: boolean;
	/** Overrides the default duration, in ms. */
	duration?: number;
}

/** The only duration table. */
export function durationFor(
	kind: ToastKind,
	opts: Pick<ToastOptions, "quick" | "undo" | "duration"> = {},
): number {
	if (kind === "busy") return Number.POSITIVE_INFINITY;
	if (opts.duration != null) return opts.duration;
	if (opts.quick) return 2500;
	if (kind === "fail") return 8000;
	if (opts.undo) return 6000;
	return 5000;
}

// Undo registry: the newest undoable toast owns the shortcut.
type UndoEntry = { id: string | number; run: () => unknown };
let currentUndo: UndoEntry | null = null;

export function registerUndo(id: string | number, run: () => unknown): void {
	currentUndo = { id, run };
}

export function clearUndo(id: string | number): void {
	if (currentUndo?.id === id) currentUndo = null;
}

export function takeUndo(): UndoEntry | null {
	const entry = currentUndo;
	currentUndo = null;
	return entry;
}

interface ShortcutEvent {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	target: EventTarget | null;
}

export function isUndoShortcut(e: ShortcutEvent): boolean {
	if (e.key.toLowerCase() !== "z") return false;
	if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return false;
	const target = e.target as { closest?: (s: string) => unknown } | null;
	if (
		target &&
		typeof target.closest === "function" &&
		target.closest("input, textarea, select, [contenteditable]")
	) {
		return false;
	}
	return true;
}

export interface ToastCardProps {
	kind: ToastKind;
	title: ReactNode;
	desc?: ReactNode;
	duration: number;
	onClose?: () => void;
	actions?: { label: string; onClick: () => void; shortcut?: boolean }[];
	mac?: boolean;
}

export function ToastCard({
	kind,
	title,
	desc,
	duration,
	onClose,
	actions = [],
	mac = true,
}: ToastCardProps) {
	const busy = kind === "busy";
	return (
		<div
			className="tst"
			role={kind === "fail" ? "alert" : "status"}
			style={{ "--life": `${duration}ms` } as CSSProperties}
		>
			<span className="tst-mark">
				{busy ? (
					<span className="tst-spin" />
				) : (
					<span className={`tst-dot ${kind}`} />
				)}
			</span>
			<span className="tst-body">
				<span className="tst-title">{title}</span>
				{desc ? <span className="tst-desc">{desc}</span> : null}
			</span>
			<span className="tst-acts">
				{actions.map((a) => (
					<button
						key={a.label}
						type="button"
						className="tst-act"
						onClick={a.onClick}
					>
						{a.label}
						{a.shortcut ? <kbd>{mac ? "⌘Z" : "Ctrl Z"}</kbd> : null}
					</button>
				))}
				{busy ? null : (
					<button
						type="button"
						className="tst-x"
						aria-label="Close"
						onClick={onClose}
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 12 12"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							aria-hidden="true"
						>
							<path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
						</svg>
					</button>
				)}
			</span>
			{busy ? null : (
				<span className="tst-life" aria-hidden="true">
					<i />
				</span>
			)}
		</div>
	);
}

function useIsMac(): boolean {
	const [mac, setMac] = useState(true);
	useEffect(() => {
		setMac(/Mac/i.test(`${navigator.platform} ${navigator.userAgent}`));
	}, []);
	return mac;
}

function LiveToastCard({
	id,
	kind,
	title,
	duration,
	opts,
}: {
	id: string | number;
	kind: ToastKind;
	title: ReactNode;
	duration: number;
	opts: ToastOptions;
}) {
	const mac = useIsMac();
	const close = () => toast.dismiss(id);
	const actions: NonNullable<ToastCardProps["actions"]> = [];
	const { retry, action, undo } = opts;
	if (retry) {
		actions.push({
			label: "Retry",
			onClick: () => {
				close();
				void retry();
			},
		});
	}
	if (action) {
		actions.push({
			label: action.label,
			onClick: () => {
				action.run();
				close();
			},
		});
	}
	if (undo) {
		actions.push({
			label: "Undo",
			shortcut: true,
			onClick: () => {
				clearUndo(id);
				void undo();
				close();
			},
		});
	}
	return (
		<ToastCard
			kind={kind}
			title={title}
			desc={opts.desc}
			duration={duration}
			onClose={close}
			actions={actions}
			mac={mac}
		/>
	);
}

function show(
	kind: ToastKind,
	title: ReactNode,
	opts: ToastOptions = {},
): string | number {
	const duration = durationFor(kind, opts);
	const id =
		opts.id ?? `tst-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	if (opts.undo) registerUndo(id, opts.undo);
	else clearUndo(id);
	toast.custom(
		(tid) => (
			<LiveToastCard
				id={tid}
				kind={kind}
				title={title}
				duration={duration}
				opts={opts}
			/>
		),
		{
			id,
			duration,
			onDismiss: () => clearUndo(id),
			onAutoClose: () => clearUndo(id),
		},
	);
	return id;
}

export const notify = {
	done: (title: ReactNode, o?: ToastOptions) => show("done", title, o),
	ok: (title: ReactNode, o?: ToastOptions) => show("ok", title, o),
	fail: (title: ReactNode, o?: ToastOptions) => show("fail", title, o),
	busy: (title: ReactNode, o?: Pick<ToastOptions, "id" | "desc">) =>
		show("busy", title, o),
	dismiss: (id: string | number) => toast.dismiss(id),
};
