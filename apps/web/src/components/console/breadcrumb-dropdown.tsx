"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface BreadcrumbDropdownProps {
	current: string;
	items: { name: string; href: string }[];
	allHref: string;
	allLabel?: string;
}

export function BreadcrumbDropdown({
	current,
	items,
	allHref,
	allLabel = "View all",
}: BreadcrumbDropdownProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}, []);

	return (
		<div className="breadcrumb-dropdown-wrap" ref={ref}>
			<span
				className="breadcrumb-dropdown-trigger"
				onClick={() => setOpen(!open)}
			>
				<span>{current}</span>
				<span className="breadcrumb-dropdown-chevron">
					<svg
						width="10"
						height="10"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
					>
						<path d="M4 6l4 4 4-4" />
					</svg>
				</span>
			</span>
			{open && (
				<div className="breadcrumb-dropdown visible">
					{items.map((item) => (
						<Link
							key={item.name}
							href={item.href}
							className={`breadcrumb-dropdown-item${item.name === current ? " active" : ""}`}
							onClick={() => setOpen(false)}
						>
							{item.name}
							<span className="check">
								<svg
									width="10"
									height="10"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
								>
									<path d="M3 8.5l3.5 3.5 6.5-8" />
								</svg>
							</span>
						</Link>
					))}
					<div className="breadcrumb-dropdown-divider" />
					<Link
						href={allHref}
						className="breadcrumb-dropdown-link"
						onClick={() => setOpen(false)}
					>
						{allLabel}
					</Link>
				</div>
			)}
		</div>
	);
}
