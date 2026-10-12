"use client";

import { KeysCard } from "@/components/account/keys-panel";
import {
	AccountHead,
	AcctCard,
	AttentionList,
	Dot,
	StatusStrip,
	StripCell,
} from "@/components/account/parts";
import { countByDisplayStatus } from "@/components/account/webhooks/shared";
import {
	activeKeys,
	formatUsd,
	refreshBilling,
	refreshCaps,
	refreshUsage,
	useAccountData,
} from "@/lib/account-data";
import { daysLeft, daysLeftLabel } from "@/lib/account-health";
import { useAuth } from "@/lib/auth";
import type { ApiKey } from "@/lib/types";
import {
	MEMORY_FLOOR_GB,
	ROWS_ALLOWANCE,
	currentUtcMonth,
	deliveredRowsIn,
	formatRows,
	fractionalDaysRemainingInMonth,
	latestMemoryHour,
	monthParam,
	projectedMonthEndUsdMicros,
	rateLabel,
	unitLabel,
} from "@/lib/usage";
import { useAccountProblems } from "@/lib/use-account-problems";
import { formatRelative } from "@/lib/webhooks-data";
import { poll, refreshList, useWebhooksCache } from "@/lib/webhooks-store";
import Link from "next/link";
import { useEffect, useState } from "react";

const CLI_INSTALL = "bun add -g @secondlayer/cli";
const API_BASE = "https://api.secondlayer.tools";
const CURL_ONE_LINE = `curl ${API_BASE}/v1/index/ft-transfers?limit=1 -H "Authorization: Bearer $SECONDLAYER_API_KEY"`;
const RECENT_KEYS = 3;

function sinceLabel(createdAt: string | undefined): string | null {
	if (!createdAt) return null;
	const d = new Date(createdAt);
	if (Number.isNaN(d.getTime())) return null;
	return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function useCopy(text: string) {
	const [copied, setCopied] = useState(false);
	return {
		copied,
		copy() {
			navigator.clipboard.writeText(text).catch(() => {});
			setCopied(true);
			setTimeout(() => setCopied(false), 1400);
		},
	};
}

const Missing = () => (
	<span className="acct-missing" role="img" aria-label="Not loaded">
		—
	</span>
);

function Strip() {
	const { billing, burn, service, usage } = useAccountData();
	const { list } = useWebhooksCache();
	const monthKey = monthParam(currentUtcMonth());
	const rows = usage[monthKey];

	const days = daysLeft(billing, burn);
	const spent = billing ? Number(billing.spentThisMonthUsdMicros) : null;
	const projected =
		spent !== null && burn
			? projectedMonthEndUsdMicros(
					spent,
					Number(burn.rateDayUsdMicros),
					fractionalDaysRemainingInMonth(new Date()),
				)
			: null;
	const delivered = rows ? deliveredRowsIn(rows) : null;
	const pct =
		delivered === null
			? null
			: Math.min(100, (delivered / ROWS_ALLOWANCE) * 100);

	const latest = service ? latestMemoryHour(service.memory24h) : null;
	const hooks = list?.data ?? null;
	const failing = hooks ? countByDisplayStatus(hooks, "error") : 0;
	const lastDelivery = hooks
		? hooks
				.map((w) => w.lastDeliveryAt)
				.filter((t): t is string => t !== null)
				.sort()
				.at(-1)
		: undefined;

	return (
		<StatusStrip label="Account status">
			<StripCell label="Balance" href="/account/credits">
				<b className="acct-strip-v">
					{billing ? formatUsd(billing.creditsUsdMicros) : <Missing />}
				</b>
				{days !== null && Number.isFinite(days) ? (
					<span className={`acct-note ${days < 2 ? "bad" : "ok"}`}>
						<Dot tone={days < 2 ? "bad" : "ok"} />
						{daysLeftLabel(days)} left
					</span>
				) : days !== null ? (
					<span className="acct-note">No ongoing charges</span>
				) : null}
			</StripCell>
			<StripCell
				label="This month"
				href="/account/credits"
				aside={projected !== null ? `proj. ${formatUsd(projected)}` : null}
			>
				<b className="acct-strip-v">
					{spent !== null ? formatUsd(spent) : <Missing />}
				</b>
				{pct !== null && delivered !== null ? (
					<>
						<div
							className="acct-bar"
							role="img"
							aria-label={`${Math.round(pct)}% of the free ${formatRows(ROWS_ALLOWANCE)} rows used`}
						>
							<i style={{ width: `${pct.toFixed(1)}%` }} />
						</div>
						<span className="acct-note">
							{formatRows(Math.min(delivered, ROWS_ALLOWANCE))} of{" "}
							{formatRows(ROWS_ALLOWANCE)} free rows used
						</span>
					</>
				) : null}
			</StripCell>
			<StripCell label="Hosted stack" href="/account/credits">
				{service ? (
					service.state === "none" ? (
						<>
							<b className="acct-strip-v sm">
								<Dot tone="off" />
								Not started
							</b>
							<span className="acct-note">Starts with your first webhook</span>
						</>
					) : (
						<>
							<b className="acct-strip-v sm">
								<Dot tone={service.state === "running" ? "ok" : "bad"} />
								{service.state === "running" ? "Running" : "Stopped"}
							</b>
							{service.state === "running" && latest ? (
								<span className="acct-note">
									{(latest.observedGb ?? latest.billedGb).toFixed(2)} GB
									{(latest.observedGb ?? latest.billedGb) < MEMORY_FLOOR_GB
										? `, billed at ${MEMORY_FLOOR_GB} GB min`
										: ""}
								</span>
							) : null}
						</>
					)
				) : (
					<b className="acct-strip-v">
						<Missing />
					</b>
				)}
			</StripCell>
			<StripCell label="Webhooks" href="/account/webhooks">
				{hooks ? (
					<>
						<b className="acct-strip-v">
							{hooks.length - failing}{" "}
							<span className="acct-strip-of">of {hooks.length}</span>
						</b>
						<span className={`acct-note${failing > 0 ? " bad" : ""}`}>
							{failing > 0
								? `${failing} failing`
								: hooks.length === 0
									? "none yet"
									: "delivering"}
							{lastDelivery ? ` · last ${formatRelative(lastDelivery)}` : ""}
						</span>
					</>
				) : (
					<b className="acct-strip-v">
						<Missing />
					</b>
				)}
			</StripCell>
		</StatusStrip>
	);
}

function RequestCard({ keys }: { keys: ApiKey[] | null }) {
	const cmd = useCopy(CURL_ONE_LINE);
	const cli = useCopy(CLI_INSTALL);
	const active = activeKeys(keys);
	const steps: {
		id: string;
		label: React.ReactNode;
		done: boolean;
		action: React.ReactNode;
	}[] = [
		{
			id: "key",
			label: "Create an API key",
			done: active.length > 0,
			action: null,
		},
		{
			id: "request",
			label: "First request",
			done: active.some((k) => k.lastUsedAt !== null),
			action: null,
		},
		{
			id: "cli",
			label: (
				<>
					Install the CLI{" "}
					<code className="acct-inline-code">{CLI_INSTALL}</code>
				</>
			),
			done: false,
			action: (
				<button
					type="button"
					className="acct-btn line small"
					onClick={cli.copy}
				>
					{cli.copied ? "Copied" : "Copy"}
				</button>
			),
		},
		{
			id: "mcp",
			label: "Point an agent at the MCP server",
			done: false,
			action: (
				<Link href="/docs/mcp" className="acct-btn line small">
					Set up
				</Link>
			),
		},
	];
	return (
		<AcctCard
			title="Make a request"
			aside={<Link href="/docs/api-reference">API reference →</Link>}
		>
			<div className="acct-term">
				<div className="acct-term-bar">
					<span>~/app</span>
					<button type="button" onClick={cmd.copy}>
						{cmd.copied ? "Copied" : "Copy"}
					</button>
				</div>
				<pre>
					<span className="a">❯</span> curl {API_BASE}
					/v1/index/ft-transfers?limit=1 \{"\n"}
					{"    "}-H "Authorization: Bearer{" "}
					<span className="a">$SECONDLAYER_API_KEY</span>"
				</pre>
			</div>
			<ul className="acct-steps" aria-label="Getting started">
				{steps.map((s) => (
					<li key={s.id} className={s.done ? "done" : undefined}>
						<span
							className={`acct-check${s.done ? " done" : ""}`}
							aria-hidden="true"
						>
							{s.done ? (
								<svg
									width="10"
									height="10"
									viewBox="0 0 10 10"
									aria-hidden="true"
								>
									<path
										d="M2 5.2l2 2 4-4.4"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.6"
									/>
								</svg>
							) : null}
						</span>
						<span>{s.label}</span>
						{s.done ? <span className="acct-step-done">done</span> : s.action}
					</li>
				))}
			</ul>
		</AcctCard>
	);
}

function KeysSummary({
	keys,
	onCreate,
}: { keys: ApiKey[] | null; onCreate: () => void }) {
	const active = activeKeys(keys);
	const recent = [...active]
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, RECENT_KEYS);
	return (
		<AcctCard
			title="API keys"
			aside={
				keys !== null ? (
					<Link href="/account/keys">All {active.length} →</Link>
				) : null
			}
		>
			{keys === null ? (
				<p className="acct-quiet">Loading keys…</p>
			) : recent.length === 0 ? (
				<p className="acct-quiet">No keys yet.</p>
			) : (
				<ul className="acct-krows">
					{recent.map((k) => (
						<li key={k.id}>
							<span>
								{k.name} <span className="acct-kprefix">{k.prefix}…</span>
							</span>
							<span className="acct-kwhen">
								{k.lastUsedAt
									? `used ${formatRelative(k.lastUsedAt)}`
									: "never used"}
							</span>
						</li>
					))}
				</ul>
			)}
			<div>
				<button
					type="button"
					className="acct-btn solid small"
					onClick={onCreate}
				>
					Create a key
				</button>
			</div>
		</AcctCard>
	);
}

function AttentionCard({ loaded }: { loaded: boolean }) {
	const problems = useAccountProblems();
	return (
		<AcctCard title="Needs attention">
			{!loaded ? (
				<p className="acct-quiet">Checking…</p>
			) : problems.length > 0 ? (
				<AttentionList problems={problems} />
			) : (
				<p className="acct-okline">
					<Dot tone="ok" />
					<span>
						Nothing right now.{" "}
						<span className="acct-quiet">
							Low balance, a stopped stack or a failing webhook shows up here
							first.
						</span>
					</span>
				</p>
			)}
		</AcctCard>
	);
}

function MeterCard() {
	const { usage } = useAccountData();
	const rows = usage[monthParam(currentUtcMonth())];
	const body = (rows ?? []).filter((r) => r.unit !== "topup");
	return (
		<AcctCard
			title="This month by meter"
			aside={<Link href="/account/credits">Usage and billing →</Link>}
		>
			{rows === undefined ? (
				<p className="acct-quiet">Loading usage…</p>
			) : body.length === 0 ? (
				<p className="acct-quiet">
					No usage yet this month. Your first {formatRows(ROWS_ALLOWANCE)} rows
					are free.
				</p>
			) : (
				<table className="acct-meters">
					<tbody>
						{body.map((r) => {
							const free =
								r.unit === "rows.delivered"
									? `first ${formatRows(ROWS_ALLOWANCE)} free`
									: rateLabel(r.unit, r.quantity) === "free"
										? "free"
										: null;
							return (
								<tr key={r.unit}>
									<td>
										{unitLabel(r.unit)[0]}
										{free ? <span className="acct-free">{free}</span> : null}
									</td>
									<td className="num">{formatUsd(r.usdMicros)}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}
		</AcctCard>
	);
}

/** /account: is everything running, what it costs, what to do next. */
export function OverviewSection() {
	const { account } = useAuth();
	const { billing, keys, service, usage } = useAccountData();
	const problems = useAccountProblems();
	const [creating, setCreating] = useState(false);
	const month = monthParam(currentUtcMonth());

	useEffect(() => {
		refreshBilling();
		refreshCaps();
	}, []);

	// Every 60s while the tab is visible, as the usage page does; this is
	// also what keeps burn and the hosted stack's state current.
	useEffect(() => {
		return poll(async () => {
			await refreshUsage(month);
			return {};
		}, 60_000);
	}, [month]);

	// Listing webhooks goes through the account's hosted stack, so only do it
	// once usage says one exists; otherwise the Webhooks cell stays "—".
	const stackExists = service !== null && service.state !== "none";
	useEffect(() => {
		if (!stackExists) return;
		return poll(async () => {
			const res = await refreshList();
			return res.kind === "starting" || res.kind === "rate_limited"
				? { retryAfterMs: res.retryAfter * 1000 }
				: {};
		}, 30_000);
	}, [stackExists]);

	const loaded =
		billing !== null && service !== null && usage[month] !== undefined;
	const since = sinceLabel(account?.createdAt);

	return (
		<>
			<AccountHead
				title="Overview"
				sub={`Hosted account${since ? ` · since ${since}` : ""}`}
			>
				{loaded ? (
					<span className="acct-state">
						<Dot tone={problems.length > 0 ? "bad" : "ok"} />
						{problems.length === 0
							? "Everything is running"
							: `${problems.length} ${problems.length === 1 ? "thing needs" : "things need"} attention`}
					</span>
				) : null}
			</AccountHead>
			<Strip />
			<div className="acct-grid2">
				<RequestCard keys={keys} />
				<div className="acct-stack">
					<AttentionCard loaded={loaded} />
					<KeysSummary keys={keys} onCreate={() => setCreating(true)} />
				</div>
			</div>
			<MeterCard />
			<KeysCard open={creating} onClose={() => setCreating(false)} />
		</>
	);
}
