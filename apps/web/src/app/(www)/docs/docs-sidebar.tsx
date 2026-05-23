"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DOCS_NAV } from "./nav";

export function DocsSidebar() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);

	// Close the mobile drawer whenever the route changes (i.e. a link is tapped).
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — close the drawer on navigation
	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	// Close on Escape while the drawer is open.
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	return (
		<>
			<button
				type="button"
				className="docs-burger"
				aria-label="Open navigation"
				aria-expanded={open}
				onClick={() => setOpen(true)}
			>
				☰
			</button>
			{open && (
				<button
					type="button"
					className="docs-nav-overlay"
					aria-label="Close navigation"
					onClick={() => setOpen(false)}
				/>
			)}
			<aside className={`docs-nav${open ? " open" : ""}`}>
				<Link href="/" className="docs-nav-brand">
					<span className="docs-nav-brand-dot" aria-hidden="true" />
					secondlayer
				</Link>
				{DOCS_NAV.map((group) => (
					<div className="docs-nav-group" key={group.label}>
						<div className="docs-nav-grouplabel">{group.label}</div>
						{group.items.map((item) => (
							<Link
								key={item.href}
								href={item.href}
								className={`docs-nav-item${pathname === item.href ? " active" : ""}`}
							>
								{item.title}
							</Link>
						))}
					</div>
				))}
			</aside>
		</>
	);
}
