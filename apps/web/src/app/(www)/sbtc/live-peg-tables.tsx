"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	type Deposit,
	PUBLIC_SBTC,
	type Withdrawal,
	ago,
	btc,
	fetchWindow,
	mempoolTx,
	num,
	stacksAddr,
	stacksTx,
	trunc,
	truncAddr,
} from "./shared";

const POLL_MS = 20_000;
const MAX_ROWS = 25;
const NEW_FLASH_MS = 1500;

function StatusBadge({ status }: { status: string }) {
	return (
		<span className={`peg-badge peg-badge-${status.toLowerCase()}`}>
			{status}
		</span>
	);
}

function LiveDot({ live }: { live: boolean }) {
	if (!live) return null;
	return (
		<span className="peg-live">
			<span className="peg-live-dot" />
			live
		</span>
	);
}

export function LivePegTables({
	initialDeposits,
	initialWithdrawals,
	serverNow,
}: {
	initialDeposits: Deposit[];
	initialWithdrawals: Withdrawal[];
	serverNow: number;
}) {
	const [deposits, setDeposits] = useState(initialDeposits);
	const [withdrawals, setWithdrawals] = useState(initialWithdrawals);
	const [newCursors, setNewCursors] = useState<Set<string>>(new Set());
	const [now, setNow] = useState(serverNow);
	const [live, setLive] = useState(false);

	// Cursor sets tracked in refs so polling can diff without nesting setState.
	const depCursors = useRef(new Set(initialDeposits.map((r) => r.cursor)));
	const wdCursors = useRef(new Set(initialWithdrawals.map((r) => r.cursor)));
	const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

	// Tick relative times post-mount only — keeps SSR and first paint identical.
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);

	const markNew = useCallback((cursors: string[]) => {
		if (cursors.length === 0) return;
		setNewCursors((prev) => new Set([...prev, ...cursors]));
		const t = setTimeout(() => {
			setNewCursors((prev) => {
				const next = new Set(prev);
				for (const c of cursors) next.delete(c);
				return next;
			});
		}, NEW_FLASH_MS);
		flashTimers.current.push(t);
	}, []);

	useEffect(() => {
		let cancelled = false;
		const timers = flashTimers.current;

		async function poll() {
			if (typeof document !== "undefined" && document.hidden) return;
			try {
				const [d, w] = await Promise.all([
					fetchWindow(PUBLIC_SBTC, "deposits", { cache: "no-store" }),
					fetchWindow(PUBLIC_SBTC, "withdrawals", { cache: "no-store" }),
				]);
				if (cancelled) return;
				if (d.rows.length) {
					const rows = (d.rows as Deposit[]).slice(0, MAX_ROWS);
					const fresh = rows
						.filter((r) => !depCursors.current.has(r.cursor))
						.map((r) => r.cursor);
					depCursors.current = new Set(rows.map((r) => r.cursor));
					setDeposits(rows);
					markNew(fresh);
				}
				if (w.rows.length) {
					const rows = (w.rows as Withdrawal[]).slice(0, MAX_ROWS);
					const fresh = rows
						.filter((r) => !wdCursors.current.has(r.cursor))
						.map((r) => r.cursor);
					wdCursors.current = new Set(rows.map((r) => r.cursor));
					setWithdrawals(rows);
					markNew(fresh);
				}
				setLive(true);
			} catch {
				// Transient network/poll error — keep the last good state, retry next tick.
			}
		}

		const id = setInterval(poll, POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
			for (const t of timers) clearTimeout(t);
		};
	}, [markNew]);

	const rowCls = (cursor: string) =>
		newCursors.has(cursor) ? "peg-row-new" : undefined;

	return (
		<>
			{/* DEPOSITS */}
			<section className="peg-sect">
				<h2>Recent deposits</h2>
				<span className="peg-sect-meta">
					peg-in · BTC&nbsp;→&nbsp;sBTC · last 24h · keyless
				</span>
				<LiveDot live={live} />
			</section>
			<div className="peg-tbl-wrap">
				<table className="peg-tbl">
					<thead>
						<tr>
							<th>Amount</th>
							<th>Bitcoin tx</th>
							<th>Stacks tx</th>
							<th className="peg-num">Block</th>
							<th>Status</th>
							<th className="peg-when">When</th>
						</tr>
					</thead>
					<tbody>
						{deposits.map((d) => (
							<tr key={d.cursor} className={rowCls(d.cursor)}>
								<td className="peg-amt">{btc(d.amount)} BTC</td>
								<td>
									<a
										className="peg-link"
										href={mempoolTx(d.bitcoin_txid)}
										target="_blank"
										rel="noreferrer"
									>
										{trunc(d.bitcoin_txid)}
									</a>
								</td>
								<td>
									<a
										className="peg-link peg-link-dim"
										href={stacksTx(d.tx_id)}
										target="_blank"
										rel="noreferrer"
									>
										{trunc(d.tx_id)}
									</a>
								</td>
								<td className="peg-num">{num.format(d.block_height)}</td>
								<td>
									<StatusBadge status="COMPLETED" />
								</td>
								<td className="peg-when" suppressHydrationWarning>
									{ago(d.block_time, now)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* WITHDRAWALS */}
			<section className="peg-sect">
				<h2>Recent withdrawals</h2>
				<span className="peg-sect-meta">
					peg-out · sBTC&nbsp;→&nbsp;BTC · last 24h · lifecycle tracked
				</span>
				<LiveDot live={live} />
			</section>
			<div className="peg-tbl-wrap">
				<table className="peg-tbl">
					<thead>
						<tr>
							<th>Request</th>
							<th>Sender</th>
							<th>Amount</th>
							<th>Status</th>
							<th>BTC sweep</th>
							<th className="peg-when">When</th>
						</tr>
					</thead>
					<tbody>
						{withdrawals.map((w) => (
							<tr key={w.cursor} className={rowCls(w.cursor)}>
								<td className="peg-req">#{w.request_id}</td>
								<td>
									<a
										className="peg-link peg-link-dim"
										href={stacksAddr(w.sender)}
										target="_blank"
										rel="noreferrer"
									>
										{truncAddr(w.sender)}
									</a>
								</td>
								<td className="peg-amt">{btc(w.amount)} BTC</td>
								<td>
									<StatusBadge status={w.status} />
								</td>
								<td>
									{w.sweep_txid ? (
										<a
											className="peg-link"
											href={mempoolTx(w.sweep_txid)}
											target="_blank"
											rel="noreferrer"
										>
											{trunc(w.sweep_txid)}
										</a>
									) : (
										<span className="peg-dash">—</span>
									)}
								</td>
								<td className="peg-when" suppressHydrationWarning>
									{ago(w.requested_at, now)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}
