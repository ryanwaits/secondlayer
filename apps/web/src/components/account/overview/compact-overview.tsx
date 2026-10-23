"use client";

import { Skel } from "@/components/dashboard/shell/skel";
import { shareLink } from "@/components/mobile/share/share-fix-sheet";
import { Sheet } from "@/components/mobile/sheet";
import { SITE } from "@/lib/docs-agent";
import { forResource, useInsights } from "@/lib/insights-store";
import { useSubgraphsCache } from "@/lib/subgraphs-store";
import { useState } from "react";
import { KeysAppsCompact } from "../keys/compact-keys";
import { PushSettings } from "../push/push-settings";
import { SubgraphCompactRow } from "../subgraphs/compact-list";
import { WebhookCompactRow } from "../webhooks/compact-list";
import type { OverviewBodyProps } from "./overview-section";
import { clockTime } from "./overview-view";
import { TopNote } from "./top-note";
import { UsageBlock } from "./usage-block";

/** The one place a phone points at the desk: building happens there. */
const DESK_NOTE = "New keys, webhooks and subgraphs are made at a desk.";

function Chevron() {
	return (
		<svg
			className="mwh-chev"
			width="8"
			height="14"
			viewBox="0 0 8 14"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M1 1l6 6-6 6" />
		</svg>
	);
}

/** The subgraph rows, read from the cache the page's own poll fills. */
export function CompactSubgraphsSlot() {
	const { list, health } = useSubgraphsCache();
	const { data: insights } = useInsights();
	if (!list || list.data.length === 0) return null;
	return (
		<div className="msg-group">
			{list.data.map((item) => (
				<SubgraphCompactRow
					key={item.name}
					item={item}
					health={health[item.name]?.data}
					insights={forResource(insights, "subgraph", item.name)}
					href={`/account/subgraphs/${encodeURIComponent(item.name)}`}
				/>
			))}
		</div>
	);
}

/** Notifications: one row that opens the push settings in a sheet. */
function NotificationsRow() {
	const [open, setOpen] = useState(false);
	return (
		<section className="ov-section" aria-label="Notifications">
			<div className="ov-section-h">
				<h2>Notifications</h2>
			</div>
			<button type="button" className="ma-row" onClick={() => setOpen(true)}>
				<span>Push notifications</span>
				<Chevron />
			</button>
			<Sheet open={open} onClose={() => setOpen(false)} title="Notifications">
				<PushSettings />
			</Sheet>
		</section>
	);
}

/** The phone has no terminal, so a block that would hold a command holds a link to this page instead. */
function SendYourselfTheLink() {
	return (
		<div>
			<button
				type="button"
				className="acct-btn line small"
				onClick={() => void shareLink("Set up Secondlayer", `${SITE}/account`)}
			>
				Send yourself the link
			</button>
		</div>
	);
}

function CompactSkeleton() {
	return (
		<output
			className="ma-skel"
			aria-busy="true"
			aria-label="Loading your account"
		>
			<Skel width="60%" height={16} />
			<Skel width="90%" height={14} />
			<Skel width="75%" height={14} />
		</output>
	);
}

/**
 * The Account page on a phone: the same blocks as the desktop page in the same
 * order, as rows and bottom sheets. No command to copy anywhere; a note's fix
 * is shared instead, and building waits for a desk.
 */
export function CompactOverviewBody({
	rows,
	billing,
	burn,
	stack,
	readUsage = null,
	subgraphs,
	keys = null,
	apps = null,
	caps = null,
	now = new Date(),
	insights = [],
	stage = "running",
	onboarding = null,
	hasSubgraphs = true,
	firstRead = null,
	topup = null,
	loading = false,
	creditsOut,
	failing,
	accountState,
}: OverviewBodyProps & {
	creditsOut: boolean;
	failing: { id: string; name: string }[];
	accountState: "credits_out" | "asleep" | null;
}) {
	if (loading) {
		return (
			<div className="ov-page ma">
				<CompactSkeleton />
			</div>
		);
	}

	if (stage === "no_key") {
		return (
			<div className="ov-page ma">
				<p className="ov-lede">
					<b>Make a key to start.</b> The SDK, the CLI and plain HTTP calls all
					read with it. The first 1M rows each month are free, no card needed.
				</p>
				<p className="ov-aside">Keys are made at a desk.</p>
				<SendYourselfTheLink />
			</div>
		);
	}

	const usage = (
		<UsageBlock
			compact
			readUsage={readUsage}
			billing={billing}
			burn={burn}
			caps={caps}
			stopped={stack?.state === "stopped"}
			returnState={topup}
			now={now}
		/>
	);
	const keysBlock = (
		<section id="keys" className="ov-section" aria-label="Keys and apps">
			<div className="ov-section-h">
				<h2>Keys and apps</h2>
			</div>
			<KeysAppsCompact keys={keys} apps={apps} now={now} />
			<p className="ov-aside">{DESK_NOTE}</p>
		</section>
	);

	if (stage === "no_reads") {
		return (
			<div className="ov-page ma">
				<section className="ov-section" aria-label="Read your first rows">
					<div className="ov-section-h">
						<h2>Read your first rows</h2>
					</div>
					<p className="ov-lede">
						{onboarding?.keyName ? (
							<>
								Your key <b>{onboarding.keyName}</b> is ready.
							</>
						) : (
							"Your key is ready."
						)}{" "}
						Nothing has read with it yet. Reading starts from a desk.
					</p>
					<SendYourselfTheLink />
				</section>
				{usage}
				{keysBlock}
				<NotificationsRow />
			</div>
		);
	}

	const topNote = (
		<TopNote
			compact
			insights={insights}
			failing={failing}
			state={accountState}
		/>
	);

	if (stage === "reading") {
		return (
			<div className="ov-page ma">
				{firstRead ? (
					<output className="ov-lede">
						✓ First read at {clockTime(firstRead.at)} from{" "}
						<b>{firstRead.keyName}</b>.
					</output>
				) : null}
				{topNote}
				{usage}
				{keysBlock}
				<NotificationsRow />
			</div>
		);
	}

	const webhookRows = rows ?? [];
	return (
		<div className="ov-page ma">
			{topNote}
			{webhookRows.length > 0 ? (
				<section id="webhooks" className="ov-section" aria-label="Webhooks">
					<div className="ov-section-h">
						<h2>Webhooks</h2>
						<span className="dash-label">Last 24h</span>
					</div>
					<div className="mwh-group">
						{webhookRows.map((row) => (
							<WebhookCompactRow
								key={row.webhook.id}
								row={row}
								stopped={creditsOut}
							/>
						))}
					</div>
				</section>
			) : null}
			{hasSubgraphs ? (
				<section id="subgraphs" className="ov-section" aria-label="Subgraphs">
					<div className="ov-section-h">
						<h2>Subgraphs</h2>
					</div>
					{subgraphs ?? <CompactSubgraphsSlot />}
				</section>
			) : null}
			{usage}
			{keysBlock}
			<NotificationsRow />
		</div>
	);
}
