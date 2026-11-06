"use client";

/**
 * What each /account page shows while its data streams in. Every one is the
 * page's own loading state (the same bodies the unseeded client renders with
 * nothing loaded), so the skeletons are the final boxes and a page that
 * streams replaces them without moving. They start no reads and no polls: the
 * streamed section does that once it arrives.
 */

import { BillingBody } from "@/components/account/billing/billing-screen";
import { UsageBody } from "@/components/account/billing/compact-usage";
import { AccountCompactHeader } from "@/components/account/compact-account";
import { KeysCompactList } from "@/components/account/keys/compact-keys";
import { KeysBody } from "@/components/account/keys/keys-screen";
import { OverviewBody } from "@/components/account/overview/overview-section";
import { RowsSkeleton } from "@/components/account/rows/rows-panel";
import { SubgraphsCompactList } from "@/components/account/subgraphs/compact-list";
import { DetailSkeleton as SubgraphDetailSkeleton } from "@/components/account/subgraphs/detail-screen";
import { SubgraphsListBody } from "@/components/account/subgraphs/list-screen";
import { WebhooksCompactList } from "@/components/account/webhooks/compact-list";
import { WebhooksListBody } from "@/components/account/webhooks/list-panel";
import { PulseBody } from "@/components/mobile/pulse/pulse-screen";
import { useCompact } from "@/components/mobile/use-compact";
import { useParams } from "next/navigation";

const noop = () => {};

/** The clock for a body that shows no time yet; the server cannot read it. */
const EPOCH = new Date(0);

export function OverviewFallback() {
	return useCompact() ? (
		<PulseBody
			insights={[]}
			summary={undefined}
			rows={null}
			billing={null}
			caps={null}
			webhookCount={0}
			subgraphCount={0}
			isNew={false}
			loaded={false}
			now={EPOCH}
			updated="–"
			seenAt={0}
			onOpen={noop}
		/>
	) : (
		<OverviewBody
			pending={{ list: true, strip: true, all: false }}
			rows={null}
			billing={null}
			burn={null}
			stack={null}
		/>
	);
}

export function WebhooksFallback() {
	return useCompact() ? (
		<WebhooksCompactList
			rows={null}
			failing={0}
			busyId={null}
			onOpen={noop}
			onTogglePause={noop}
		/>
	) : (
		<WebhooksListBody
			rows={null}
			hours={[]}
			notice={null}
			summaryLoaded={false}
			onOpenHour={noop}
		/>
	);
}

export function SubgraphsFallback() {
	return useCompact() ? (
		<SubgraphsCompactList
			items={null}
			health={{}}
			insights={[]}
			notice={null}
			onOpen={noop}
		/>
	) : (
		<SubgraphsListBody items={null} health={{}} notice={null} />
	);
}

export function RowsFallback() {
	return <RowsSkeleton />;
}

export function KeysFallback() {
	return useCompact() ? (
		<>
			<AccountCompactHeader current="keys" />
			<KeysCompactList keys={null} now={EPOCH} onOpen={noop} />
		</>
	) : (
		<KeysBody keys={null} now={EPOCH} onNew={noop} />
	);
}

export function CreditsFallback() {
	const now = new Date();
	return useCompact() ? (
		<>
			<AccountCompactHeader current="usage" />
			<UsageBody
				now={now}
				billing={null}
				capUsd={null}
				usage={undefined}
				daily={undefined}
				burn={null}
				service={null}
				onTopUp={noop}
			/>
		</>
	) : (
		<BillingBody
			now={now}
			billing={null}
			burn={null}
			service={null}
			usage={undefined}
			daily={undefined}
			capUsd={null}
			onCapChange={noop}
			credits={null}
			addCredits={null}
			settings={null}
		/>
	);
}

/** The subgraph detail page's skeleton. The name comes from the URL, which
 *  the page itself reads inside its boundary. */
export function SubgraphDetailFallback() {
	const { name } = useParams<{ name: string }>();
	let decoded = name;
	try {
		decoded = decodeURIComponent(name);
	} catch {
		// Keep the raw segment, as the page does.
	}
	return <SubgraphDetailSkeleton name={decoded} />;
}
