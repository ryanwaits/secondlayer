"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DetailTabs({
	items,
}: {
	items: { label: string; href: string }[];
}) {
	const pathname = usePathname();

	function isActive(href: string, index: number) {
		if (index === 0) return pathname === href;
		return pathname.startsWith(href);
	}

	return (
		<nav className="detail-tabs">
			{items.map((item, i) => (
				<Link
					key={item.href}
					href={item.href}
					className={`detail-tab${isActive(item.href, i) ? " active" : ""}`}
				>
					{item.label}
				</Link>
			))}
		</nav>
	);
}
