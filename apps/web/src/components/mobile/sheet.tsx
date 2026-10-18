"use client";

import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	type Ref,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { type Detent, settleSheet } from "./gesture";

type SheetContent = {
	/** Visible title; also the dialog's accessible name. */
	title: ReactNode;
	/** Small line above the title (severity, resource name). */
	eyebrow?: ReactNode;
	children: ReactNode;
};

/**
 * The sheet's markup without the portal, focus or gesture wiring. `Sheet`
 * renders this; the Lab and tests render it directly because a portal does not
 * exist on the server.
 */
export function SheetPanel({
	title,
	eyebrow,
	children,
	detent,
	panelRef,
	titleId,
	grabHandlers,
}: SheetContent & {
	/** `"auto"` sizes to the content (max 92%). */
	detent: Detent | "auto";
	panelRef?: Ref<HTMLDivElement>;
	titleId?: string;
	grabHandlers?: {
		onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
		onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
		onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
		onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
	};
}) {
	const fallbackId = useId();
	const id = titleId ?? fallbackId;
	return (
		<div
			ref={panelRef}
			// biome-ignore lint/a11y/useSemanticElements: a modal sheet needs aria-modal; <dialog open> is non-modal
			role="dialog"
			aria-modal="true"
			aria-labelledby={id}
			tabIndex={-1}
			className={`m-sheet is-${detent}`}
		>
			<div className="m-sheet-grab" aria-hidden="true" {...grabHandlers}>
				<i />
			</div>
			<header className="m-sheet-head">
				{eyebrow ? <div className="m-sheet-eyebrow">{eyebrow}</div> : null}
				<h2 id={id}>{title}</h2>
			</header>
			<div className="m-sheet-body">{children}</div>
		</div>
	);
}

function SheetLayer({
	onClose,
	detents,
	initialDetent,
	...content
}: SheetContent & {
	onClose: () => void;
	detents: "auto" | readonly Detent[];
	initialDetent: Detent;
}) {
	const titleId = useId();
	const panelRef = useRef<HTMLDivElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const allowed: readonly Detent[] = detents === "auto" ? [] : detents;
	const [detent, setDetent] = useState<Detent>(
		allowed.includes(initialDetent) ? initialDetent : (allowed[0] ?? "half"),
	);
	const drag = useRef<{ y0: number; dy: number } | null>(null);

	// Escape closes, focus moves into the sheet and returns to the opener, and
	// the page behind stops scrolling while it is open.
	useEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCloseRef.current();
		};
		document.addEventListener("keydown", onKey);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		panelRef.current?.focus({ preventScroll: true });
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prevOverflow;
			opener?.focus?.({ preventScroll: true });
		};
	}, []);

	const endDrag = (commit: boolean) => {
		const state = drag.current;
		drag.current = null;
		const panel = panelRef.current;
		if (!state || !panel) return;
		panel.classList.remove("is-drag");
		panel.style.transform = "";
		if (!commit) return;
		const next = settleSheet(state.dy, detent, allowed);
		if (next === "closed") onCloseRef.current();
		else setDetent(next);
	};

	const grabHandlers = {
		onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
			drag.current = { y0: e.clientY, dy: 0 };
			e.currentTarget.setPointerCapture(e.pointerId);
			panelRef.current?.classList.add("is-drag");
		},
		onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
			const state = drag.current;
			if (!state || !panelRef.current) return;
			state.dy = e.clientY - state.y0;
			// Dragging up resists: the sheet expands on release, it does not follow.
			panelRef.current.style.transform = `translateY(${state.dy > 0 ? state.dy : state.dy / 3}px)`;
		},
		onPointerUp: () => endDrag(true),
		onPointerCancel: () => endDrag(false),
	};

	return (
		<>
			{/* The entry animation is CSS on these two elements and runs when they
			    mount. Keep them keyed by position and never toggle an animation class
			    from state, or the slide-up replays on every re-render. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the keyboard close */}
			<div
				className="m-scrim"
				aria-hidden="true"
				onClick={() => onCloseRef.current()}
			/>
			<SheetPanel
				{...content}
				detent={detents === "auto" ? "auto" : detent}
				panelRef={panelRef}
				titleId={titleId}
				grabHandlers={grabHandlers}
			/>
		</>
	);
}

/**
 * A bottom sheet for the phone screens. Drag the grab handle: down closes (or
 * drops full to half), up expands half to full. Portals to the body, locks page
 * scroll, closes on Escape or a scrim tap, and returns focus to the opener.
 */
export function Sheet({
	open,
	onClose,
	detents = "auto",
	initialDetent = "half",
	...content
}: SheetContent & {
	open: boolean;
	onClose: () => void;
	/** `"auto"` = height of content (max 92%); otherwise the allowed detents. */
	detents?: "auto" | readonly Detent[];
	initialDetent?: Detent;
}) {
	if (!open || typeof document === "undefined") return null;
	return createPortal(
		<SheetLayer
			{...content}
			onClose={onClose}
			detents={detents}
			initialDetent={initialDetent}
		/>,
		document.body,
	);
}
