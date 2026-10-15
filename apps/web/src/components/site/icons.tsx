import type { ReactNode } from "react";

/**
 * Product-page glyphs: common shapes in the house hand. 20-unit grid with 2 of
 * padding, 1.2 stroke, round ends, currentColor. Each shape is used once across
 * the /p pages; the docs product stack reuses one per product. At most one accent part per glyph (DESIGN.md, Product glyphs):
 * `glyph-pri` for what the claim is about, `glyph-alarm` for a failure.
 */
function Glyph({ children }: { children: ReactNode }) {
	return (
		<svg
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

export function LockIcon() {
	return (
		<Glyph>
			<rect x="4" y="9" width="12" height="8.5" rx="2" />
			<path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
			<path className="glyph-pri" d="M10 12.25v2" />
		</Glyph>
	);
}

/** Stacked partitions at the logo's layer slant. */
export function LayersIcon() {
	return (
		<Glyph>
			<path d="M3 6 11.75 2.5 17 6 8.25 9.5ZM3 14 8.25 17.5 17 14" />
			<path className="glyph-pri" d="M3 10 8.25 13.5 17 10" />
		</Glyph>
	);
}

export function DownloadIcon() {
	return (
		<Glyph>
			<path className="glyph-pri" d="M10 3v9M6.5 8.5 10 12l3.5-3.5" />
			<path d="M3.5 13v2a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2" />
		</Glyph>
	);
}

export function PlayIcon() {
	return (
		<Glyph>
			<circle cx="10" cy="10" r="7" />
			<path
				className="glyph-pri"
				d="M8.5 7.25v5.5L12.75 10Z"
				fill="currentColor"
			/>
		</Glyph>
	);
}

export function TerminalIcon() {
	return (
		<Glyph>
			<rect x="2.5" y="3.5" width="15" height="13" rx="2" />
			<path className="glyph-pri" d="m6 8 2.5 2L6 12" />
			<path d="M10.5 12.5h3.5" />
		</Glyph>
	);
}

export function BranchIcon() {
	return (
		<Glyph>
			<path d="M5.5 3v9.5M14.5 7.5a7 7 0 0 1-7 7" />
			<circle cx="5.5" cy="14.5" r="2" />
			<circle className="glyph-pri" cx="14.5" cy="5.5" r="2" />
		</Glyph>
	);
}

export function FilterIcon() {
	return (
		<Glyph>
			<path d="M3 4h14l-5.5 6.5V16l-3 1.5v-7Z" />
		</Glyph>
	);
}

export function MailIcon() {
	return (
		<Glyph>
			<rect x="2.5" y="4.5" width="15" height="11" rx="2" />
			<path className="glyph-pri" d="m3 5.5 7 5.5 7-5.5" />
		</Glyph>
	);
}

export function ShieldCheckIcon() {
	return (
		<Glyph>
			<path d="M10 2.5 16 5v5c0 3.6-2.6 6.2-6 7.5-3.4-1.3-6-3.9-6-7.5V5Z" />
			<path className="glyph-pri" d="m7.25 10 2 2 3.5-3.75" />
		</Glyph>
	);
}

/** Webhooks: a signal arriving. */
export function PulseIcon() {
	return (
		<Glyph>
			<path d="M4 11h4l2-5 3 9 2-4h1" />
			<circle className="glyph-pri" cx="16.5" cy="11" r="1.2" />
		</Glyph>
	);
}

/** Subgraphs: a table you define. */
export function TableIcon() {
	return (
		<Glyph>
			<rect x="3" y="4" width="14" height="12" rx="2" />
			<path className="glyph-pri" d="M3 8h14M8 8v8" />
		</Glyph>
	);
}

/** Index: decoded rows. */
export function RowsIcon() {
	return (
		<Glyph>
			<path d="M4 6h12M4 10h12M4 14h8" />
			<path className="glyph-pri" d="M14 14h2" />
		</Glyph>
	);
}

/** Streams: events flowing. */
export function WavesIcon() {
	return (
		<Glyph>
			<path d="M3 7c2.5-2 4.5 2 7 0s4.5-2 7 0M3 13c2.5-2 4.5 2 7 0s4.5-2 7 0" />
			<path className="glyph-pri" d="M3 10c2.5-2 4.5 2 7 0s4.5-2 7 0" />
		</Glyph>
	);
}

export function FileXIcon() {
	return (
		<Glyph>
			<path d="M5.5 2.5h6L15 6v10a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 16V4a1.5 1.5 0 0 1 1.5-1.5ZM11.5 2.5V6H15" />
			<path className="glyph-alarm" d="m7.5 10.5 4 4m0-4-4 4" />
		</Glyph>
	);
}

export function UndoIcon() {
	return (
		<Glyph>
			<path d="M7 4 3.5 7.5 7 11" />
			<path d="M3.5 7.5h8.5a4.5 4.5 0 0 1 0 9H8" />
		</Glyph>
	);
}

export function BoxIcon() {
	return (
		<Glyph>
			<path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6Z" />
			<path d="m3.5 6 6.5 3.5L16.5 6M10 9.5v8" />
		</Glyph>
	);
}

export function KeyIcon() {
	return (
		<Glyph>
			<circle className="glyph-pri" cx="7" cy="13" r="3.5" />
			<path d="m9.5 10.5 7-7M14 6l2 2M12 8l1.5 1.5" />
		</Glyph>
	);
}

export function HistoryIcon() {
	return (
		<Glyph>
			<path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6L3.5 7.3M3.5 3.5v3.8h3.8" />
			<path className="glyph-pri" d="M10 6.5V10l2.5 1.5" />
		</Glyph>
	);
}

export function ListXIcon() {
	return (
		<Glyph>
			<path d="M3 5.5h14M3 10h14M3 14.5h7" />
			<path className="glyph-alarm" d="m13 12.5 4 4m0-4-4 4" />
		</Glyph>
	);
}
