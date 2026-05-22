"use client";

import { highlightCode } from "@/components/command-palette/actions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface DataPayloadPopoverProps {
	/** Full row rendered as flat, syntax-highlighted JSON in the popover. */
	row: Record<string, unknown>;
}

/**
 * "Data" button that opens an anchored popover with the full row as flat,
 * Shiki-highlighted JSON (LiveKit-style payload view). Portaled to `document.body`
 * because the data table clips overflow; positioned with fixed coordinates from the
 * trigger's rect and re-anchored on scroll/resize. Closes on Esc or outside click.
 */
export function DataPayloadPopover({ row }: DataPayloadPopoverProps) {
	const [open, setOpen] = useState(false);
	const [html, setHtml] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	const btnRef = useRef<HTMLButtonElement>(null);
	const popRef = useRef<HTMLDivElement>(null);

	const json = useMemo(() => JSON.stringify(row, null, 2), [row]);
	const title = useMemo(() => {
		const id = row._id ?? row.id;
		return id != null ? `Row ${id}` : "Row";
	}, [row]);

	// Lazily highlight on first open; result is cached for the row's lifetime.
	useEffect(() => {
		if (!open || html !== null) return;
		let cancelled = false;
		highlightCode(json, "json").then((res) => {
			if (!cancelled) setHtml(res);
		});
		return () => {
			cancelled = true;
		};
	}, [open, html, json]);

	const position = useCallback(() => {
		const btn = btnRef.current;
		if (!btn) return;
		const r = btn.getBoundingClientRect();
		const pop = popRef.current;
		const pw = pop?.offsetWidth ?? 360;
		const ph = pop?.offsetHeight ?? 220;
		// Right-align the popover to the trigger; clamp into the viewport.
		const left = Math.max(
			12,
			Math.min(r.right - pw, window.innerWidth - pw - 12),
		);
		// Drop below the trigger, or flip above when there isn't room.
		const top =
			r.bottom + ph + 16 > window.innerHeight
				? Math.max(12, r.top - ph - 8)
				: r.bottom + 8;
		setPos({ left, top });
	}, []);

	useEffect(() => {
		if (!open) return;
		position();
		// Move focus into the popover so keyboard/SR users land on the payload,
		// which is portaled away from the trigger in the DOM.
		popRef.current?.focus({ preventScroll: true });
		const onDocMouseDown = (e: MouseEvent) => {
			const t = e.target as Node;
			if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
			setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				btnRef.current?.focus({ preventScroll: true });
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", onDocMouseDown);
		document.addEventListener("keydown", onKey);
		window.addEventListener("resize", position);
		window.addEventListener("scroll", position, true);
		return () => {
			document.removeEventListener("mousedown", onDocMouseDown);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", position);
			window.removeEventListener("scroll", position, true);
		};
	}, [open, position]);

	// Re-anchor once the highlighted body changes the popover's height.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `html` is a trigger — re-measure after the body renders
	useEffect(() => {
		if (open) position();
	}, [open, html, position]);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(json);
		setCopied(true);
		setTimeout(() => setCopied(false), 1400);
	}, [json]);

	return (
		<>
			<button
				ref={btnRef}
				type="button"
				className={`data-payload-btn${open ? " open" : ""}`}
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
			>
				Data
				<span className="data-payload-ico">
					<svg
						width="11"
						height="11"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<circle cx="8" cy="8" r="6" />
						<path d="M8 7v4" />
						<circle cx="8" cy="5" r="0.5" fill="currentColor" />
					</svg>
				</span>
			</button>
			{open &&
				createPortal(
					<div
						ref={popRef}
						className="data-payload-pop"
						// biome-ignore lint/a11y/useSemanticElements: anchored non-modal popover; native <dialog> doesn't fit the inline positioning model
						role="dialog"
						aria-label={`${title} payload`}
						tabIndex={-1}
						style={
							pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }
						}
					>
						<div className="data-payload-head">
							<span className="data-payload-title">{title}</span>
							<button
								type="button"
								className="data-payload-copy"
								onClick={handleCopy}
							>
								<svg
									width="10"
									height="10"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<rect x="5" y="5" width="9" height="9" rx="1.5" />
									<path d="M5 11H3.5A1.5 1.5 0 0 1 2 9.5V3.5A1.5 1.5 0 0 1 3.5 2h6A1.5 1.5 0 0 1 11 3.5V5" />
								</svg>
								{copied ? "Copied" : "Copy"}
							</button>
						</div>
						{html ? (
							<div
								className="data-payload-body"
								// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki-highlighted JSON
								dangerouslySetInnerHTML={{ __html: html }}
							/>
						) : (
							<pre className="data-payload-body data-payload-fallback">
								<code>{json}</code>
							</pre>
						)}
					</div>,
					document.body,
				)}
		</>
	);
}
