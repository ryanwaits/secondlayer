"use client";

import { PRODUCTS, isActive } from "@/lib/site";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const CLOSE_DELAY_MS = 120;

/**
 * The five products as a hover menu, shared by the marketing and docs bars.
 * Hover opens it; click and Enter toggle it for touch and keyboard. Escape,
 * an outside click and navigation close it.
 */
export function ProductsMenu({ className }: { className?: string }) {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const hovering = useRef(false);
	const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const onProduct = PRODUCTS.some((p) => isActive(pathname, p.href));

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the close trigger
	useEffect(() => setOpen(false), [pathname]);
	useEffect(() => () => clearTimeout(closeTimer.current), []);
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			setOpen(false);
			rootRef.current?.querySelector("button")?.focus();
		};
		const onClick = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("click", onClick);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("click", onClick);
		};
	}, [open]);

	return (
		<div
			className={className ? `products-menu ${className}` : "products-menu"}
			ref={rootRef}
			onMouseEnter={() => {
				hovering.current = true;
				clearTimeout(closeTimer.current);
				setOpen(true);
			}}
			onMouseLeave={() => {
				hovering.current = false;
				closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
			}}
		>
			<button
				type="button"
				className="products-menu-btn"
				aria-expanded={open}
				aria-controls="products-menu-panel"
				aria-current={onProduct ? "true" : undefined}
				// A mouse click while hovering keeps the menu open instead of
				// closing what the hover just opened.
				onClick={() => setOpen((v) => (hovering.current ? true : !v))}
			>
				Products
			</button>
			{open ? (
				<div className="products-menu-panel" id="products-menu-panel">
					{PRODUCTS.map((p) => (
						<Link
							key={p.href}
							href={p.href}
							aria-current={isActive(pathname, p.href) ? "page" : undefined}
						>
							{p.noun}
						</Link>
					))}
				</div>
			) : null}
		</div>
	);
}
