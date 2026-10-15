"use client";

import { Choice } from "@/components/choice";
import {
	ROW_USD_PER_M_VOLUME,
	VOLUME_TIER_MONTHLY_USD,
	estimateMonth,
	usd,
	usdExact,
} from "@/lib/prices";
import { useState } from "react";

const STACK_OPTIONS = [
	{ value: "running", label: "Running" },
	{ value: "stopped", label: "None or stopped" },
] as const;
const ROWS = [
	0, 100e3, 250e3, 500e3, 1e6, 2e6, 5e6, 10e6, 20e6, 50e6, 100e6, 250e6, 500e6,
	1e9,
] as const;
const MEMORY_GB = [0.5, 1, 1.5, 2, 3, 4] as const;
const STORAGE_GB = [0, 0.1, 0.25, 0.5, 1] as const;
const WEBHOOK_EVENTS = [
	0, 10e3, 100e3, 250e3, 500e3, 1e6, 2e6, 5e6, 10e6, 20e6,
] as const;

const count = new Intl.NumberFormat("en-US");

function Slider({
	id,
	label,
	value,
	max,
	display,
	hint,
	disabled,
	onChange,
}: {
	id: string;
	label: string;
	value: number;
	max: number;
	display: string;
	hint?: string;
	disabled?: boolean;
	onChange: (index: number) => void;
}) {
	return (
		<div className="ctl" aria-disabled={disabled ? "true" : undefined}>
			<div className="top">
				<label htmlFor={id}>{label}</label>
				<output htmlFor={id}>{display}</output>
			</div>
			<input
				id={id}
				type="range"
				min={0}
				max={max}
				step={1}
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(Number(e.target.value))}
			/>
			{hint ? <span className="hint">{hint}</span> : null}
		</div>
	);
}

/**
 * Month estimator. The math is `estimateMonth` in `lib/prices.ts`, which
 * mirrors the platform meter; sliders step through fixed, round values.
 */
export function PricingEstimator() {
	const [rows, setRows] = useState(6);
	const [running, setRunning] = useState(true);
	const [memory, setMemory] = useState(0);
	const [storage, setStorage] = useState(2);
	const [hooks, setHooks] = useState(3);

	const rowCount = ROWS[rows];
	const memoryGb = MEMORY_GB[memory];
	const storageGb = STORAGE_GB[storage];
	const webhookEvents = WEBHOOK_EVENTS[hooks];

	const e = estimateMonth({
		rows: rowCount,
		running,
		memoryGb,
		storageGb,
		webhookEvents,
	});
	const freeRows = Math.min(rowCount, 1_000_000);

	return (
		<div className="est">
			<div className="est-in">
				<Slider
					id="est-rows"
					label="Rows delivered per month"
					value={rows}
					max={ROWS.length - 1}
					display={count.format(rowCount)}
					hint="Event and transaction rows from Index or Streams. Block headers don't count."
					onChange={setRows}
				/>
				<div className="ctl">
					<div className="top">
						<span id="est-stack">Hosted stack</span>
					</div>
					<Choice
						name="est-stack"
						labelledBy="est-stack"
						options={STACK_OPTIONS}
						value={running ? "running" : "stopped"}
						onChange={(v) => setRunning(v === "running")}
					/>
					<span className="hint">
						Needed for hosted webhooks and subgraphs.
					</span>
				</div>
				<Slider
					id="est-memory"
					label="Stack memory"
					value={memory}
					max={MEMORY_GB.length - 1}
					display={`${memoryGb} GB`}
					disabled={!running}
					onChange={setMemory}
				/>
				<Slider
					id="est-storage"
					label="Stack storage"
					value={storage}
					max={STORAGE_GB.length - 1}
					display={`${storageGb} GB`}
					disabled={!running}
					onChange={setStorage}
				/>
				<Slider
					id="est-hooks"
					label="Webhook events per month"
					value={hooks}
					max={WEBHOOK_EVENTS.length - 1}
					display={count.format(webhookEvents)}
					disabled={!running}
					onChange={setHooks}
				/>
			</div>
			<div className="est-out" aria-live="polite">
				<span className="eyebrow">Monthly estimate</span>
				<div className="lines">
					<div className="line">
						<span>Rows · {count.format(e.billableRows)} billable</span>
						<span>{usdExact(e.rowsUsd)}</span>
					</div>
					{e.volumeRows > 0 ? (
						<div className="line">
							<span>
								of which {count.format(Math.round(e.volumeRows))} past{" "}
								{usd(VOLUME_TIER_MONTHLY_USD)} at {usd(ROW_USD_PER_M_VOLUME)} /
								1M
							</span>
							<span>{usdExact(e.volumeUsd)}</span>
						</div>
					) : null}
					<div className="line">
						<span>Free rows this month</span>
						<span>
							<span className="free">{count.format(freeRows)}</span>
						</span>
					</div>
					<div className="line">
						<span>
							{running
								? `Stack memory · ${Math.max(memoryGb, 0.5)} GB`
								: "Stack memory · stopped"}
						</span>
						<span>{usdExact(e.memoryUsd)}</span>
					</div>
					<div className="line">
						<span>Stack storage</span>
						<span>{usdExact(e.storageUsd)}</span>
					</div>
					<div className="line">
						<span>Webhook events</span>
						<span>{usdExact(e.webhooksUsd)}</span>
					</div>
					<div className="line">
						<span>Retries, headers, verify</span>
						<span>
							<span className="free">free</span>
						</span>
					</div>
				</div>
				<div className="total">
					<span>Estimate</span>
					<b>{usdExact(e.totalUsd)}</b>
				</div>
				<p className="note">Estimate. Your statement is the exact figure.</p>
			</div>
		</div>
	);
}
