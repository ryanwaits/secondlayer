"use client";

import { isSuccessDelivery } from "@/lib/webhooks-data";
import type { DeliveryRow } from "@secondlayer/sdk";

const MAX_MS = 2000;
const WIDTH = 700;
const HEIGHT = 120;
const PAD = { l: 44, r: 6, t: 6, b: 16 };

/** Bar height = response time (capped at 2s), 2xx blue, error/timeout red
 *  with a minimum visible height so a fast failure still shows up. The API
 *  returns rows newest first; the chart reads oldest → latest, left to
 *  right, so it's reversed here. */
export function AttemptsChart({ rows }: { rows: DeliveryRow[] }) {
	const ordered = [...rows].reverse();
	const cw = WIDTH - PAD.l - PAD.r;
	const ch = HEIGHT - PAD.t - PAD.b;
	const bw = ordered.length > 0 ? cw / ordered.length : cw;

	function y(v: number): number {
		return PAD.t + ch - (Math.min(v, MAX_MS) / MAX_MS) * ch;
	}

	return (
		<svg
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
			preserveAspectRatio="none"
			role="img"
			aria-label="Response time of the last 100 delivery attempts"
		>
			{[0, 1000, 2000].map((v) => (
				<g key={v}>
					<line
						x1={PAD.l}
						x2={WIDTH - PAD.r}
						y1={y(v)}
						y2={y(v)}
						stroke="var(--border)"
						strokeWidth={1}
					/>
					<text
						x={PAD.l - 6}
						y={y(v) + 3.5}
						textAnchor="end"
						fill="var(--text-muted)"
						fontFamily="var(--font-mono-stack)"
						fontSize={10}
					>
						{v === 0 ? "0" : v === 2000 ? "2s+" : "1s"}
					</text>
				</g>
			))}
			{ordered.map((d, i) => {
				const ok = isSuccessDelivery(d);
				const duration = d.durationMs ?? MAX_MS;
				const top = y(duration);
				const hgt = Math.max(ok ? 2 : 14, PAD.t + ch - top);
				return (
					<rect
						// Bars are positional (oldest → latest); nothing else identifies one.
						// biome-ignore lint/suspicious/noArrayIndexKey: positional, not an identity
						key={i}
						x={PAD.l + i * bw + 0.6}
						y={PAD.t + ch - hgt}
						width={Math.max(1, bw - 1.2)}
						height={hgt}
						rx={1}
						fill={ok ? "var(--accent-blue)" : "var(--red)"}
						opacity={ok ? 0.85 : 1}
					>
						<title>
							{d.statusCode ?? "timeout"} · {Math.round(duration)} ms
						</title>
					</rect>
				);
			})}
			<text
				x={PAD.l}
				y={HEIGHT - 3}
				fill="var(--text-muted)"
				fontFamily="var(--font-mono-stack)"
				fontSize={10}
			>
				oldest
			</text>
			<text
				x={WIDTH - PAD.r}
				y={HEIGHT - 3}
				textAnchor="end"
				fill="var(--text-muted)"
				fontFamily="var(--font-mono-stack)"
				fontSize={10}
			>
				latest
			</text>
		</svg>
	);
}

export function medianOkDurationMs(rows: DeliveryRow[]): number {
	const durations = rows
		.filter(isSuccessDelivery)
		.map((r) => r.durationMs ?? 0)
		.sort((a, b) => a - b);
	if (durations.length === 0) return 0;
	return durations[Math.floor(durations.length / 2)] ?? 0;
}
