"use client";

import { useInstanceMeta } from "@/lib/instance-meta";
import Link from "next/link";

/**
 * Topbar for every console screen: a lowercase mono breadcrumb on the left
 * (path segments muted, current segment ink) and the instance's network chip
 * on the right. Liveness lives in the floating live pill, not here — no
 * last-updated / block / auto-refresh cluster.
 */
export interface Crumb {
	label: string;
	href?: string;
}

export function OverviewTopbar({ crumbs }: { crumbs: Crumb[] }) {
	const { network } = useInstanceMeta();

	return (
		<div className="overview-topbar">
			<span className="crumb">
				{crumbs.map((c, i) => {
					const isLast = i === crumbs.length - 1;
					return (
						<span key={`${c.label}-${i}`}>
							{i > 0 && <span className="sep">/</span>}
							{isLast ? (
								<span className="here">{c.label}</span>
							) : c.href ? (
								<Link href={c.href}>{c.label}</Link>
							) : (
								c.label
							)}
						</span>
					);
				})}
			</span>
			{network && <span className="net">{network}</span>}
		</div>
	);
}
