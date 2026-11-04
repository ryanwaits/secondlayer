// Server-only: never import from client code.
import { type ReactElement, cache, createElement } from "react";

/**
 * Per-request timing of a dashboard page's server render. Always records
 * (`performance.now()` calls only), and emits only when the request has
 * `?timing=1`: one `<script type="application/json" id="sl-render-timing">`
 * at the end of the page. The output holds labels, durations and offsets from
 * the request's first timed step; API paths have every id, name and query
 * dropped (`/api/webhooks/:id/deliveries`). No tokens or account data.
 */

export const TIMING_SCRIPT_ID = "sl-render-timing";

interface Step {
	label: string;
	startMs: number;
	/** null while the step is still running. */
	ms: number | null;
	detail?: Record<string, string | number>;
}

export interface RenderTimingReport {
	/** First request this instance has served. */
	coldStart: boolean;
	/** Request start to the moment the page asked for the report. */
	totalMs: number;
	steps: Step[];
}

// Why module scope: a warm instance reuses it across requests, which is the
// cold/warm distinction being measured.
let warm = false;

/** Literal path segments that are safe to print; anything else is data. */
const LITERAL_SEGMENTS = new Set([
	"api",
	"v1",
	"webhooks",
	"subgraphs",
	"activity",
	"deliveries",
	"health",
	"errors",
	"source",
	"billing",
	"status",
	"caps",
	"alerts",
	"credits",
	"keys",
	"oauth",
	"grants",
	"usage",
	"rows",
	"insights",
	"accounts",
]);

/** The path with the query dropped and every id, name and table as `:id`.
 *  Under `/v1/` everything after the collection is data, so it all redacts. */
export function redactPath(path: string): string {
	const segments = path.split("?")[0].split("/").filter(Boolean);
	const collection = segments.findIndex(
		(segment) => segment === "webhooks" || segment === "subgraphs",
	);
	const v1 = segments[0] === "v1";
	return `/${segments
		.map((segment, index) => {
			if (collection === -1 || index <= collection) {
				return redactSegment(segment);
			}
			if (index === collection + 1) {
				// `/api/webhooks/activity` is the summary route, not a webhook.
				const summary =
					segments[collection] === "webhooks" && segment === "activity";
				return summary ? segment : ":id";
			}
			return v1 ? ":id" : redactSegment(segment);
		})
		.join("/")}`;
}

function redactSegment(segment: string): string {
	return LITERAL_SEGMENTS.has(segment) ? segment : ":id";
}

export class RequestTiming {
	readonly coldStart: boolean;
	private readonly origin: number;
	private enabled = false;
	private readonly steps: Step[] = [];
	private readonly running = new Set<Promise<unknown>>();

	constructor(private readonly now: () => number = () => performance.now()) {
		this.coldStart = !warm;
		warm = true;
		this.origin = now();
	}

	/** Turns emission on when the request has `?timing=1`. */
	enableFrom(searchParams: { timing?: string | string[] }): this {
		const value = searchParams.timing;
		if ((Array.isArray(value) ? value[0] : value) === "1") this.enabled = true;
		return this;
	}

	/** Runs and times `run`; resolves or rejects exactly as it does. */
	step<T>(
		label: string,
		run: () => Promise<T>,
		detail?: Record<string, string | number>,
	): Promise<T> {
		const start = this.now();
		const entry: Step = {
			label,
			startMs: round(start - this.origin),
			ms: null,
		};
		if (detail) entry.detail = detail;
		this.steps.push(entry);
		const finish = () => {
			entry.ms = round(this.now() - start);
		};
		const tracked = run().then(
			(value) => {
				finish();
				return value;
			},
			(error) => {
				finish();
				throw error;
			},
		);
		const settled = tracked.then(
			() => undefined,
			() => undefined,
		);
		this.running.add(settled);
		settled.then(() => this.running.delete(settled));
		return tracked;
	}

	/** A zero-length point on the timeline. */
	mark(label: string): void {
		this.steps.push({
			label,
			startMs: round(this.now() - this.origin),
			ms: 0,
		});
	}

	/** The page's report, or null without `?timing=1`. Waits for steps other
	 *  components (the layout) started, but `totalMs` is taken first. */
	async report(): Promise<RenderTimingReport | null> {
		if (!this.enabled) return null;
		const totalMs = round(this.now() - this.origin);
		await Promise.all([...this.running]);
		return { coldStart: this.coldStart, totalMs, steps: this.steps };
	}

	/** The `<script>` to render last in the page, or null without the flag. */
	async script(): Promise<ReactElement | null> {
		const report = await this.report();
		if (!report) return null;
		return createElement("script", {
			type: "application/json",
			id: TIMING_SCRIPT_ID,
			// biome-ignore lint/security/noDangerouslySetInnerHtml: JSON of labels and numbers with `<` escaped, so no value can close the tag
			dangerouslySetInnerHTML: {
				__html: JSON.stringify(report).replace(/</g, "\\u003c"),
			},
		});
	}
}

/** The current request's timer: layout, page and reads share one. Outside a
 *  server render (route handlers, tests) each call gets its own. */
export const getTiming = cache((): RequestTiming => new RequestTiming());

function round(ms: number): number {
	return Math.round(ms * 10) / 10;
}
