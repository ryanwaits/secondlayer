"use client";

import { useEffect, useRef, useState } from "react";
import { annotate } from "rough-notation";

export function BoxBadge({ children }: { children: React.ReactNode }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [shown, setShown] = useState(false);

	useEffect(() => {
		if (!ref.current) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting && !shown) {
					setShown(true);
					requestAnimationFrame(() => {
						if (!ref.current) return;
						const color = getComputedStyle(document.documentElement)
							.getPropertyValue("--accent-purple")
							.trim();
						const annotation = annotate(ref.current, {
							type: "box",
							color,
							strokeWidth: 1.5,
							padding: [1, 3],
							animate: true,
							animationDuration: 800,
							iterations: 1,
						});
						annotation.show();
					});
				}
			},
			{ threshold: 0.5 },
		);

		observer.observe(ref.current);
		return () => observer.disconnect();
	}, [shown]);

	return (
		<span style={{ paddingLeft: "0.75rem", display: "inline-block" }}>
			<span
				ref={ref}
				style={{
					color: "var(--accent-purple)",
					fontFamily: "var(--font-cursive), cursive",
					fontSize: "18px",
					fontWeight: 400,
					position: "relative",
				}}
			>
				{children}
			</span>
		</span>
	);
}
