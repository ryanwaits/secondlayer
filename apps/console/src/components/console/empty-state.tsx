import { CopyButton } from "@/components/console/copy-button";
import Link from "next/link";
import type { ReactNode } from "react";

export function EmptyState({
	icon,
	title,
	message,
	command,
	docHref,
	docLabel,
	ghostRows = 0,
	action,
}: {
	/** Rich mode: small framed icon above the title. */
	icon?: ReactNode;
	/** Rich mode: headline. When omitted, falls back to the simple
	 *  message+action layout used by not-found pages. */
	title?: string;
	message: string;
	/** Rich mode: a copyable CLI command (e.g. `secondlayer subgraphs deploy …`). */
	command?: string;
	/** External docs URL (the console ships no docs routes of its own). */
	docHref?: string;
	docLabel?: string;
	/** Rich mode: count of faded skeleton rows hinting where real content lands. */
	ghostRows?: number;
	/** Simple mode: single inline action link. */
	action?: { label: string; href?: string };
}) {
	const rich = Boolean(title || command || ghostRows);

	if (!rich) {
		return (
			<div className="dash-empty">
				<p>{message}</p>
				{action && (
					<div className="dash-empty-action">
						{action.href ? (
							<Link href={action.href}>{action.label}</Link>
						) : (
							<span>{action.label}</span>
						)}
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="empty-stage">
			{ghostRows > 0 && (
				<div className="empty-ghost" aria-hidden="true">
					{Array.from({ length: ghostRows }).map((_, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: static decorative skeleton, no reorder
							key={i}
							className="empty-ghost-row"
						>
							<span className="egl" style={{ width: 110 + ((i * 29) % 90) }} />
							<span className="egl egl-badge" />
							<span
								className="egl"
								style={{ width: 80 + ((i * 17) % 60), marginLeft: "auto" }}
							/>
						</div>
					))}
				</div>
			)}
			<div className="empty-card">
				{icon && <div className="empty-card-ic">{icon}</div>}
				<h2>{title}</h2>
				<p>{message}</p>
				{command && (
					<div className="empty-card-cmd">
						<code>{command}</code>
						<CopyButton code={command} inline />
					</div>
				)}
				{docHref && (
					<div className="empty-card-links">
						<a href={docHref} target="_blank" rel="noopener noreferrer">
							{docLabel ?? "Read the docs →"}
						</a>
					</div>
				)}
			</div>
		</div>
	);
}
