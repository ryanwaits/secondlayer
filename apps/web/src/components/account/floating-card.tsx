"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * A card that floats in from the right for quick account jobs (keys,
 * credits). The page stays readable and usable beside it, nudged left, with
 * no overlay; one card at a time. Expand opens the job's full page. Escape
 * and any click outside close it; focus moves in on open and back on close.
 */
export function FloatingCard({
	open,
	onClose,
	title,
	subtitle,
	expandHref,
	onExpand,
	footer,
	children,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	subtitle?: React.ReactNode;
	/** The full page for this job, opened by the expand button. */
	expandHref: string;
	/** Runs just before expanding, to carry state the page can't refetch. */
	onExpand?: () => void;
	footer?: React.ReactNode;
	children: React.ReactNode;
}) {
	const cardRef = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	// Callers pass inline closures; the effect below must not re-run (and
	// re-focus) on every render because of that.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!open) return;
		const root = document.documentElement;
		root.setAttribute("data-acct-card", "");
		const opener = document.activeElement as HTMLElement | null;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCloseRef.current();
		};
		const onPointerDown = (e: PointerEvent) => {
			if (!cardRef.current?.contains(e.target as Node)) onCloseRef.current();
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("pointerdown", onPointerDown);
		// A text field (naming a key) takes focus; otherwise the card does, so
		// no single choice (the first of four amounts) looks pre-selected.
		const card = cardRef.current;
		(
			card?.querySelector<HTMLElement>('input:not([type="radio"])') ?? card
		)?.focus({ preventScroll: true });
		return () => {
			root.removeAttribute("data-acct-card");
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("pointerdown", onPointerDown);
			opener?.focus?.({ preventScroll: true });
		};
	}, [open]);

	if (!open || typeof document === "undefined") return null;

	return createPortal(
		<dialog
			ref={cardRef}
			open
			className="acct-card"
			tabIndex={-1}
			aria-labelledby={titleId}
		>
			<header className="acct-card-head">
				<div>
					<h2 id={titleId} className="acct-card-title">
						{title}
					</h2>
					{subtitle ? <p className="acct-card-sub">{subtitle}</p> : null}
				</div>
				<Link
					href={expandHref}
					className="acct-card-icon"
					aria-label="Open full page"
					onClick={() => {
						onExpand?.();
						onCloseRef.current();
					}}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
					</svg>
				</Link>
				<button
					type="button"
					className="acct-card-icon"
					aria-label="Close"
					onClick={() => onCloseRef.current()}
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
			<div className="acct-card-body">{children}</div>
			{footer ? <footer className="acct-card-foot">{footer}</footer> : null}
		</dialog>,
		document.body,
	);
}
