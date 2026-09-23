"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * A panel that slides in from the right over the current page, for quick
 * account jobs (a key, credits) without leaving where you are. Escape and the
 * backdrop close it; focus moves in on open and back to the opener on close.
 */
export function Sheet({
	open,
	onClose,
	title,
	subtitle,
	footer,
	children,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	subtitle?: React.ReactNode;
	footer?: React.ReactNode;
	children: React.ReactNode;
}) {
	const panelRef = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	// Callers pass inline closures; the effect below must not re-run (and
	// re-focus) on every render because of that.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!open) return;
		const opener = document.activeElement as HTMLElement | null;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCloseRef.current();
		};
		document.addEventListener("keydown", onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		// A text field (naming a key) takes focus; otherwise the panel does, so
		// no single choice (the first of four amounts) looks pre-selected.
		const panel = panelRef.current;
		(
			panel?.querySelector<HTMLElement>('input:not([type="radio"])') ?? panel
		)?.focus();
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prev;
			opener?.focus?.();
		};
	}, [open]);

	if (!open || typeof document === "undefined") return null;

	return createPortal(
		<div className="acct-sheet-root">
			<button
				type="button"
				className="acct-sheet-backdrop"
				aria-label="Close"
				tabIndex={-1}
				onClick={onClose}
			/>
			<dialog
				ref={panelRef}
				open
				className="acct-sheet"
				tabIndex={-1}
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<header className="acct-sheet-head">
					<div>
						<h2 id={titleId} className="acct-sheet-title">
							{title}
						</h2>
						{subtitle ? <p className="acct-sheet-sub">{subtitle}</p> : null}
					</div>
					<button
						type="button"
						className="acct-sheet-close"
						aria-label="Close"
						onClick={onClose}
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							aria-hidden="true"
						>
							<path d="M3 3l10 10M13 3L3 13" />
						</svg>
					</button>
				</header>
				<div className="acct-sheet-body">{children}</div>
				{footer ? <footer className="acct-sheet-foot">{footer}</footer> : null}
			</dialog>
		</div>,
		document.body,
	);
}
