"use client";

import {
	type ReactNode,
	createContext,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { InlineKeyCreate, type KeyProduct } from "./inline-key-create";

/**
 * Turns a phrase already in the prose (e.g. "API key") into the trigger for an
 * anchored key-creation panel.
 *
 *   <InlineKey product="streams">
 *     …every request needs an <KeyTrigger>API key</KeyTrigger>, …
 *   </InlineKey>
 *
 * On wide screens the panel docks in the right gutter beside the trigger and
 * the content column nudges left to make room — the sidebar is position:fixed,
 * so it stays put. Below 1240px it expands inline beneath the text instead.
 *
 * Dismisses on Escape, an outside pointer press, or focus leaving the block.
 * Auth-aware via InlineKeyCreate: a new visitor gets email → code → key; a
 * signed-in user mints a key in one click.
 */
const KeyCtx = createContext<{
	open: boolean;
	toggle: () => void;
	panelId: string;
} | null>(null);

export function InlineKey({
	product = "streams",
	children,
}: {
	product?: KeyProduct;
	children?: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [mounted, setMounted] = useState(false); // panel present in DOM
	const [active, setActive] = useState(false); // panel animated in
	const wrapRef = useRef<HTMLDivElement>(null);
	const panelId = useId();

	// Mount on open; keep mounted through the exit transition before unmounting.
	useEffect(() => {
		if (open) {
			setMounted(true);
			return;
		}
		setActive(false);
		const t = setTimeout(() => setMounted(false), 320);
		return () => clearTimeout(t);
	}, [open]);

	// Activate the enter transition once the panel has painted in its closed
	// state (two frames to avoid a skipped transition).
	useEffect(() => {
		if (!open || !mounted) return;
		const r = requestAnimationFrame(() =>
			requestAnimationFrame(() => setActive(true)),
		);
		return () => cancelAnimationFrame(r);
	}, [open, mounted]);

	// Dismiss on outside pointer press or Escape.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	// Dismiss when focus leaves the block entirely (e.g. tabbing past it).
	const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
		const next = e.relatedTarget as Node | null;
		if (next && !wrapRef.current?.contains(next)) setOpen(false);
	};

	return (
		<KeyCtx.Provider
			value={{ open, toggle: () => setOpen((o) => !o), panelId }}
		>
			<div
				className="inline-key"
				data-open={active ? "true" : "false"}
				ref={wrapRef}
				onBlur={onBlur}
			>
				<p>{children}</p>
				{mounted ? (
					<div
						id={panelId}
						className={`inline-key-panel${active ? " is-open" : ""}`}
					>
						<InlineKeyCreate
							product={product}
							context="inline"
							onKey={() => {}}
							onCancel={() => setOpen(false)}
						/>
					</div>
				) : null}
			</div>
		</KeyCtx.Provider>
	);
}

/** The clickable phrase inside an <InlineKey>. */
export function KeyTrigger({ children }: { children: ReactNode }) {
	const ctx = useContext(KeyCtx);
	// Outside a provider, degrade to plain text rather than throwing.
	if (!ctx) return <>{children}</>;
	return (
		<button
			type="button"
			className="inline-keylink"
			aria-expanded={ctx.open}
			aria-controls={ctx.panelId}
			onClick={ctx.toggle}
		>
			{children}
		</button>
	);
}
