"use client";

import { useEffect, useRef, useState } from "react";
import { annotate } from "rough-notation";
import type { RoughAnnotationType } from "rough-notation/lib/model";

interface NotationProps {
	children: React.ReactNode;
	type?: RoughAnnotationType;
	color?: string;
	strokeWidth?: number;
	padding?: number | [number, number, number, number];
	animate?: boolean;
	animationDuration?: number;
	iterations?: number;
	brackets?: ("left" | "right" | "top" | "bottom")[];
	multiline?: boolean;
	/** Highlight only: fraction of line-height to paint (library default is 0.95). */
	coverage?: number;
	/** Wait this many ms after the mark is in view before drawing. */
	delay?: number;
	label?: string;
	labelPosition?: "right" | "left" | "top" | "bottom";
}

export function Notation({
	children,
	type = "circle",
	color = "currentColor",
	strokeWidth = 1.5,
	padding = 5,
	animate = true,
	animationDuration = 400,
	iterations = 2,
	brackets,
	multiline = false,
	coverage,
	delay = 0,
	label,
	labelPosition = "right",
}: NotationProps) {
	const ref = useRef<HTMLSpanElement>(null);
	const shown = useRef(false);

	useEffect(() => {
		if (!ref.current) return;
		const el = ref.current;
		let annotation: ReturnType<typeof annotate> | null = null;
		let mo: MutationObserver | null = null;
		let start: ReturnType<typeof setTimeout> | null = null;

		const thinHighlight = () => {
			if (type !== "highlight" || coverage == null) return;
			const svg = el.previousElementSibling?.classList.contains(
				"rough-annotation",
			)
				? el.previousElementSibling
				: el.nextElementSibling;
			if (!(svg instanceof SVGElement)) return;
			const sw = Math.max(4, el.getBoundingClientRect().height * coverage);
			for (const p of svg.querySelectorAll("path")) {
				p.setAttribute("stroke-width", String(sw));
				p.setAttribute("stroke-linecap", "square");
			}
		};

		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting || shown.current) return;
				shown.current = true;
				const draw = () => {
					annotation = annotate(el, {
						type,
						color,
						strokeWidth,
						padding,
						animate,
						animationDuration,
						iterations,
						brackets: brackets as never,
						multiline,
					});
					annotation.show();
					thinHighlight();
					const svg = el.previousElementSibling?.classList.contains(
						"rough-annotation",
					)
						? el.previousElementSibling
						: el.nextElementSibling;
					if (svg) {
						mo = new MutationObserver(thinHighlight);
						mo.observe(svg, { childList: true });
					}
				};
				if (delay > 0) start = setTimeout(draw, delay);
				else draw();
			},
			{ threshold: 0.1 },
		);

		observer.observe(el);
		return () => {
			observer.disconnect();
			if (start) clearTimeout(start);
			mo?.disconnect();
			annotation?.remove();
			shown.current = false;
		};
	}, [
		type,
		color,
		strokeWidth,
		padding,
		animate,
		animationDuration,
		iterations,
		brackets,
		multiline,
		coverage,
		delay,
	]);

	const labelEl = label ? (
		<span className="notation-label" data-position={labelPosition}>
			{label}
		</span>
	) : null;

	return (
		<span className="notation-wrap" style={{ position: "relative" }}>
			<span ref={ref} className="notation-target">
				{children}
			</span>
			{labelEl}
		</span>
	);
}

/**
 * Block-level notation — wraps a paragraph or section with an annotation + optional cursive label.
 */
export function NotationBlock({
	children,
	type = "bracket",
	color = "currentColor",
	strokeWidth = 1.5,
	padding,
	animate = true,
	animationDuration = 600,
	iterations = 1,
	brackets = ["right"],
	label,
	labelPosition = "right",
}: NotationProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [shown, setShown] = useState(false);

	useEffect(() => {
		if (!ref.current) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting && !shown) {
					setShown(true);

					// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
					const annotation = annotate(ref.current!, {
						type,
						color,
						strokeWidth,
						padding: padding ?? [2, 8, 2, 0],
						animate,
						animationDuration,
						iterations,
						brackets: brackets as never,
					});

					annotation.show();

					return () => annotation.remove();
				}
			},
			{ threshold: 0.3 },
		);

		observer.observe(ref.current);
		return () => observer.disconnect();
	}, [
		shown,
		type,
		color,
		strokeWidth,
		padding,
		animate,
		animationDuration,
		iterations,
		brackets,
	]);

	const labelEl = label ? (
		<span className="notation-label" data-position={labelPosition}>
			{label}
		</span>
	) : null;

	return (
		<div className="notation-block-wrap" style={{ position: "relative" }}>
			<div ref={ref}>{children}</div>
			{labelEl}
		</div>
	);
}
