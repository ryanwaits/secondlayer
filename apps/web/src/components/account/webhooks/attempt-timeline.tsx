import type { DeliveryRow } from "@secondlayer/sdk";
import type { CSSProperties } from "react";
import { isOk } from "./view";

const BODY_LIMIT = 2_000;

/** "+4m 02s" from the first attempt; the first attempt itself has no offset. */
function offsetLabel(ms: number): string {
	if (ms <= 0) return "";
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `+${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `+${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * One step per attempt on an event (status, time, offset from the first
 * attempt, duration), then the receiver's response body when it sent one.
 * `attempts` is oldest first.
 */
export function AttemptTimeline({
	attempts,
}: { attempts: readonly DeliveryRow[] }) {
	const first = attempts[0] ? Date.parse(attempts[0].dispatchedAt) : 0;
	const body = [...attempts]
		.reverse()
		.find((a) => a.responseBody)?.responseBody;
	return (
		<>
			<div
				className="ins-timeline"
				style={{ "--n": attempts.length } as CSSProperties}
			>
				{attempts.map((a) => {
					const offset = offsetLabel(Date.parse(a.dispatchedAt) - first);
					return (
						<div key={a.id} className={isOk(a) ? "ok" : "failed"}>
							<b>
								Attempt {a.attempt} · {a.statusCode ?? "no response"}
							</b>
							{a.dispatchedAt.slice(11, 19)} UTC{offset ? ` ${offset}` : ""}
							<br />
							<small>
								{a.durationMs === null ? "–" : `${a.durationMs} ms`}
								{a.errorMessage ? ` · ${a.errorMessage}` : ""}
							</small>
						</div>
					);
				})}
			</div>
			{body ? (
				<pre className="wd-body">
					{body.length > BODY_LIMIT ? `${body.slice(0, BODY_LIMIT)}…` : body}
				</pre>
			) : null}
		</>
	);
}
