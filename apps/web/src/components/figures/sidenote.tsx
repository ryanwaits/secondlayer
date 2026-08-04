"use client";

import { POSTS } from "@/lib/writing";
import { usePathname } from "next/navigation";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useMediaQuery } from "./use-media-query";

/**
 * A5 Sidenote — a numbered aside for hedges, sources, and precision
 * upgrades that would break the paragraph's stride.
 *
 * Two presentations, chosen per post via `notes` in the writings registry:
 *
 *   inline    a ruled aside dropped into the column, always visible
 *   popover   the column stays unbroken; the marker opens the note
 *
 * There is deliberately no margin variant any more. Notes used to float into
 * the margin at a fixed -216px offset, which clipped silently the moment the
 * post shell moved. Both of these are independent of page geometry, so the
 * shell can be re-laid-out without breaking them again.
 *
 * Popovers want a pointer, so a coarse-pointer device gets the inline
 * treatment regardless of what the post asked for.
 *
 * Usage: place inside the paragraph right after the referenced phrase, with
 * the note body as children.
 */
export function Sidenote({
	n,
	children,
	variant,
}: {
	n: number;
	children: ReactNode;
	/** Overrides the post's mode for a single note. Rarely needed. */
	variant?: "inline" | "popover";
}) {
	const pathname = usePathname();
	const canHover = useMediaQuery("(hover: hover) and (pointer: fine)");

	const slug = pathname.split("/").filter(Boolean).pop();
	const post = POSTS.find((p) => p.slug === slug);
	const mode = variant ?? post?.notes ?? "inline";

	const sup = "¹²³⁴⁵⁶⁷⁸⁹"[n - 1] ?? `(${n})`;

	if (mode === "popover" && canHover) {
		return (
			<SidenotePopover n={n} sup={sup}>
				{children}
			</SidenotePopover>
		);
	}

	return (
		<>
			<sup className="fig-snref-static">{sup}</sup>
			<span className="fig-snbody inline">
				<b>{n}</b>. {children}
			</span>
		</>
	);
}

function SidenotePopover({
	n,
	sup,
	children,
}: { n: number; sup: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [shift, setShift] = useState(0);
	const id = useId();
	const wrapRef = useRef<HTMLSpanElement | null>(null);
	const cardRef = useRef<HTMLSpanElement | null>(null);

	// Keep the card inside the reading column — a marker near the end of a line
	// would otherwise open a card that runs off the measure.
	useLayoutEffect(() => {
		if (!open) {
			setShift(0);
			return;
		}
		const card = cardRef.current;
		const column = wrapRef.current?.closest(".writing-article");
		if (!card || !column) return;
		const c = card.getBoundingClientRect();
		const col = column.getBoundingClientRect();
		const overflowRight = c.right - col.right;
		const overflowLeft = col.left - c.left;
		if (overflowRight > 0) setShift(-Math.ceil(overflowRight));
		else if (overflowLeft > 0) setShift(Math.ceil(overflowLeft));
	}, [open]);

	const close = useCallback(() => setOpen(false), []);

	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") close();
		}
		function onClick(e: MouseEvent) {
			if (!wrapRef.current?.contains(e.target as Node)) close();
		}
		document.addEventListener("keydown", onKey);
		document.addEventListener("click", onClick);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("click", onClick);
		};
	}, [open, close]);

	return (
		<span className="fig-snpop" ref={wrapRef} data-open={open}>
			<button
				type="button"
				className="fig-snref"
				aria-expanded={open}
				aria-controls={id}
				onClick={(e) => {
					e.stopPropagation();
					setOpen((v) => !v);
				}}
			>
				{sup}
			</button>
			<span
				className="fig-snpop-card"
				id={id}
				role="note"
				ref={cardRef}
				style={shift ? { marginLeft: `${shift}px` } : undefined}
			>
				<b>{n}</b>. {children}
			</span>
		</span>
	);
}
