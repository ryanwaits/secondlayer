"use client";

interface StreamConfigCardProps {
	name: string;
	endpointUrl: string;
	filters: unknown[];
	options: Record<string, unknown>;
	status?: string;
	html?: string;
}

/**
 * Read-only display of a stream's config. Used by both scaffold_stream and
 * read_stream since the shape is identical. The JSON HTML is produced
 * server-side by shiki — we render it with `dangerouslySetInnerHTML` the
 * same way CodeCard does for TypeScript.
 */
export function StreamConfigCard({
	name,
	endpointUrl,
	filters,
	options,
	status,
	html,
}: StreamConfigCardProps) {
	const filterSummaries = filters.map((f) => {
		const obj = f as { type?: string } & Record<string, unknown>;
		if (!obj?.type) return "unknown";
		const extras = Object.entries(obj)
			.filter(([k]) => k !== "type")
			.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
			.join(" ");
		return extras ? `${obj.type} · ${extras}` : obj.type;
	});

	return (
		<div className="tool-card">
			<div className="tool-card-header">
				Stream {name}
				{status ? ` · ${status}` : ""}
			</div>
			<div className="tool-status-row">
				<div className="tool-action-detail">
					<span className="tool-status-name">{endpointUrl}</span>
					<span className="tool-action-reason">
						{filters.length} filter{filters.length === 1 ? "" : "s"} ·{" "}
						{(options.rateLimit as number | undefined) ?? 10}/min ·{" "}
						{(options.maxRetries as number | undefined) ?? 3} retries
					</span>
				</div>
			</div>
			<div className="tool-status-row">
				<div className="tool-action-detail">
					{filterSummaries.map((s, i) => (
						<span key={`filter-${i}`} className="tool-action-reason">
							{s}
						</span>
					))}
				</div>
			</div>
			{html && (
				<pre
					className="tool-step-output"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki HTML is trusted server output
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			)}
		</div>
	);
}
