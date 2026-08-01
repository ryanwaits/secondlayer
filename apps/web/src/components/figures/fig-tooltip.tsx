"use client";

import {
	type ReactNode,
	type RefObject,
	useCallback,
	useRef,
	useState,
} from "react";

/**
 * Shared chart tooltip: mouse/touch-following, clamped to BOTH container
 * edges. Charts call `show(event, content)` from their marks and render
 * `tooltip` inside their `.fig-chart-wrap` (which must be the ref target).
 */
export function useFigTooltip(wrapRef: RefObject<HTMLDivElement | null>) {
	const [content, setContent] = useState<ReactNode>(null);
	const [pos, setPos] = useState({ left: 0, top: 8 });
	const ttRef = useRef<HTMLDivElement>(null);

	const show = useCallback(
		(
			e: { clientX?: number; touches?: ArrayLike<{ clientX: number }> },
			node: ReactNode,
			top = 8,
		) => {
			const wrap = wrapRef.current;
			if (!wrap) return;
			const wr = wrap.getBoundingClientRect();
			const cx = e.touches?.[0]?.clientX ?? e.clientX ?? wr.left;
			const x = cx - wr.left;
			const ttW = ttRef.current?.offsetWidth ?? 120;
			setContent(node);
			setPos({
				left: Math.max(4, Math.min(x + 10, wr.width - ttW - 4)),
				top,
			});
		},
		[wrapRef],
	);

	const hide = useCallback(() => setContent(null), []);

	const tooltip = (
		<div
			ref={ttRef}
			className={content ? "fig-tooltip on" : "fig-tooltip"}
			style={{ left: pos.left, top: pos.top }}
		>
			{content}
		</div>
	);

	return { show, hide, tooltip };
}
