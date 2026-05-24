"use client";

import { useState } from "react";

/**
 * Lightweight recursive, collapsible JSON viewer.
 * Objects/arrays auto-collapse past `expandDepth`; long strings truncate.
 */
export function CollapsibleJsonTree({
	data,
	expandDepth = 2,
}: {
	data: unknown;
	expandDepth?: number;
}) {
	return (
		<div className="sl-json">
			<JsonValue value={data} depth={0} expandDepth={expandDepth} />
		</div>
	);
}

const STRING_MAX = 80;

function JsonValue({
	value,
	depth,
	expandDepth,
}: {
	value: unknown;
	depth: number;
	expandDepth: number;
}) {
	if (value === null) return <span className="sl-json-null">null</span>;

	if (typeof value === "string") {
		const truncated = value.length > STRING_MAX;
		const shown = truncated ? `${value.slice(0, STRING_MAX)}…` : value;
		return (
			<span className="sl-json-string" title={truncated ? value : undefined}>
				"{shown}"
			</span>
		);
	}

	if (typeof value === "number" || typeof value === "bigint") {
		return <span className="sl-json-number">{String(value)}</span>;
	}

	if (typeof value === "boolean") {
		return <span className="sl-json-bool">{String(value)}</span>;
	}

	if (Array.isArray(value)) {
		return (
			<Branch
				entries={value.map((v, i) => [i, v] as const)}
				open="["
				close="]"
				kind="array"
				depth={depth}
				expandDepth={expandDepth}
			/>
		);
	}

	if (typeof value === "object") {
		return (
			<Branch
				entries={Object.entries(value as Record<string, unknown>)}
				open="{"
				close="}"
				kind="object"
				depth={depth}
				expandDepth={expandDepth}
			/>
		);
	}

	return <span className="sl-json-null">{String(value)}</span>;
}

function Branch({
	entries,
	open,
	close,
	kind,
	depth,
	expandDepth,
}: {
	entries: readonly (readonly [string | number, unknown])[];
	open: string;
	close: string;
	kind: "array" | "object";
	depth: number;
	expandDepth: number;
}) {
	const [isOpen, setIsOpen] = useState(depth < expandDepth);

	if (entries.length === 0) {
		return (
			<span className="sl-json-punct">
				{open}
				{close}
			</span>
		);
	}

	const count = entries.length;
	const summary =
		kind === "array"
			? `${count} item${count === 1 ? "" : "s"}`
			: `${count} key${count === 1 ? "" : "s"}`;

	return (
		<span className="sl-json-branch">
			<button
				type="button"
				className="sl-json-toggle"
				onClick={() => setIsOpen((o) => !o)}
				aria-expanded={isOpen}
			>
				<span className="sl-json-chevron" data-open={isOpen}>
					▸
				</span>
				<span className="sl-json-punct">{open}</span>
				{!isOpen ? (
					<span className="sl-json-summary">
						{" "}
						… {summary} {close}
					</span>
				) : null}
			</button>
			{isOpen ? (
				<>
					<div className="sl-json-children">
						{entries.map(([key, val], i) => (
							<div className="sl-json-row" key={String(key)}>
								{kind === "object" ? (
									<>
										<span className="sl-json-key">"{key}"</span>
										<span className="sl-json-punct">: </span>
									</>
								) : null}
								<JsonValue
									value={val}
									depth={depth + 1}
									expandDepth={expandDepth}
								/>
								{i < count - 1 ? (
									<span className="sl-json-punct">,</span>
								) : null}
							</div>
						))}
					</div>
					<span className="sl-json-punct">{close}</span>
				</>
			) : null}
		</span>
	);
}
