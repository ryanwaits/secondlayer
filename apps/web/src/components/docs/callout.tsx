import type { ReactNode } from "react";

/** Aside variants — each maps to a semantic color token (see globals.css). */
type CalloutType = "note" | "tip" | "info" | "warning" | "danger";

// Inline icons (no icon-lib dependency): 16px, currentColor stroke.
const ICONS: Record<CalloutType, ReactNode> = {
	note: (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
		</svg>
	),
	info: (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
		</svg>
	),
	tip: (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<path
				d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 2H14.6c0-.8.3-1.5.9-2A6 6 0 0 0 12 3Z"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	),
	warning: (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<path
				d="M10.3 3.9 1.8 18.3A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.7L13.7 3.9a2 2 0 0 0-3.4 0Z"
				strokeLinejoin="round"
			/>
			<path d="M12 9v4M12 17h.01" strokeLinecap="round" />
		</svg>
	),
	danger: (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="9" />
			<path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round" />
		</svg>
	),
};

/**
 * Inline aside for breaking up prose runs — a tinted hairline card with an
 * icon and optional title. Provided globally to MDX (mdx-components.tsx), so
 * `<Callout type="tip" title="…">…</Callout>` works in any .mdx with no import.
 */
export function Callout({
	type = "note",
	title,
	children,
}: {
	type?: CalloutType;
	title?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className={`docs-callout docs-callout-${type}`} role="note">
			<span className="docs-callout-icon" aria-hidden="true">
				{ICONS[type]}
			</span>
			<div className="docs-callout-body">
				{title && <p className="docs-callout-title">{title}</p>}
				{children}
			</div>
		</div>
	);
}

/**
 * Full-width lead-in strip — a louder, title-forward break than Callout, for
 * "what you'll build" / key-takeaway moments. Optional accent label + arrow.
 */
export function Banner({
	label,
	title,
	children,
}: {
	label?: string;
	title?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="docs-banner">
			{label && <span className="docs-banner-label">{label}</span>}
			{title && <p className="docs-banner-title">{title}</p>}
			{children && <div className="docs-banner-body">{children}</div>}
		</div>
	);
}
