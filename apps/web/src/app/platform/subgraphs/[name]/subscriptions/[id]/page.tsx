import { BreadcrumbDropdown } from "@/components/console/breadcrumb-dropdown";
import { DetailSection } from "@/components/console/detail-section";
import { MetaGrid } from "@/components/console/meta-grid";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, getSessionFromCookies } from "@/lib/api";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubscriptionActions } from "./actions";
import { DeliveryLog } from "./delivery-log";
import { Dlq } from "./dlq";
import { ReplayDialog } from "./replay-dialog";

interface SubscriptionDetail {
	id: string;
	name: string;
	status: "active" | "paused" | "error";
	subgraphName: string;
	tableName: string;
	format: string;
	runtime: string | null;
	url: string;
	filter: Record<string, unknown>;
	authConfig: Record<string, unknown>;
	maxRetries: number;
	timeoutMs: number;
	concurrency: number;
	circuitFailures: number;
	circuitOpenedAt: string | null;
	lastDeliveryAt: string | null;
	lastSuccessAt: string | null;
	lastError: string | null;
	createdAt: string;
	updatedAt: string;
}

interface SubscriptionSummary {
	id: string;
	name: string;
	subgraphName: string;
}

function statusBadgeClass(status: string) {
	if (status === "active") return "active";
	if (status === "paused") return "syncing";
	return "error";
}

export default async function SubscriptionDetailPage({
	params,
}: {
	params: Promise<{ name: string; id: string }>;
}) {
	const { name, id } = await params;
	const session = await getSessionFromCookies();
	if (!session) notFound();

	let sub: SubscriptionDetail;
	let siblings: SubscriptionSummary[] = [];
	try {
		const [detailResult, listResult] = await Promise.allSettled([
			fetchFromTenantOrThrow<SubscriptionDetail>(
				session,
				`/api/subscriptions/${id}`,
			),
			fetchFromTenantOrThrow<{ data: SubscriptionSummary[] }>(
				session,
				"/api/subscriptions",
			),
		]);
		if (detailResult.status === "rejected") {
			if (
				detailResult.reason instanceof ApiError &&
				detailResult.reason.status === 404
			) {
				notFound();
			}
			throw detailResult.reason;
		}
		sub = detailResult.value;
		if (sub.subgraphName !== name) notFound();
		if (listResult.status === "fulfilled") {
			siblings = listResult.value.data.filter((s) => s.subgraphName === name);
		}
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) notFound();
		throw e;
	}

	const dropdownItems = siblings.map((s) => ({
		name: s.name,
		href: `/subgraphs/${name}/subscriptions/${s.id}`,
	}));

	return (
		<>
			<OverviewTopbar
				path={
					<>
						<Link
							href="/subgraphs"
							style={{ color: "inherit", textDecoration: "none" }}
						>
							Subgraphs
						</Link>
						{" / "}
						<Link
							href={`/subgraphs/${name}`}
							style={{ color: "inherit", textDecoration: "none" }}
						>
							{name}
						</Link>
						{" / "}
						<Link
							href={`/subgraphs/${name}/subscriptions`}
							style={{ color: "inherit", textDecoration: "none" }}
						>
							Subscriptions
						</Link>
					</>
				}
				page={
					<BreadcrumbDropdown
						current={sub.name}
						items={dropdownItems}
						allHref={`/subgraphs/${name}/subscriptions`}
						allLabel="View all subscriptions"
					/>
				}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<MetaGrid
						items={[
							{
								label: "Status",
								value: (
									<span
										className={`badge ${statusBadgeClass(sub.status)}`}
									>
										{sub.status}
									</span>
								),
								tooltip: "Current delivery state of this subscription",
							},
							{
								label: "Source",
								value: `${sub.subgraphName}.${sub.tableName}`,
								mono: true,
								tooltip: "Subgraph table this subscription observes",
							},
							{
								label: "Format",
								value: sub.format,
								mono: true,
								tooltip: "Payload format sent to the receiver",
							},
							{
								label: "Runtime",
								value: sub.runtime ?? "—",
								mono: true,
								tooltip: "Receiver runtime adapter",
							},
							{
								label: "URL",
								value: sub.url,
								mono: true,
								copyValue: sub.url,
								tooltip: "Delivery endpoint",
								span: 2,
							},
							{
								label: "Last delivery",
								value: sub.lastDeliveryAt
									? new Date(sub.lastDeliveryAt).toLocaleString()
									: "—",
								tooltip: "Most recent delivery attempt timestamp",
							},
							{
								label: "Last success",
								value: sub.lastSuccessAt
									? new Date(sub.lastSuccessAt).toLocaleString()
									: "—",
								tooltip: "Most recent 2xx response from the receiver",
							},
							{
								label: "Circuit failures",
								value: sub.circuitFailures.toString(),
								tooltip:
									"Consecutive delivery failures. Circuit opens after threshold and pauses delivery.",
							},
							{
								label: "Last error",
								value: sub.lastError ?? "—",
								tooltip: "Most recent delivery error message",
								span: 2,
							},
						]}
					/>

					<SubscriptionActions
						id={sub.id}
						subgraphName={name}
						status={sub.status}
					/>

					<DetailSection title="Replay">
						<ReplayDialog subscriptionId={sub.id} />
					</DetailSection>

					<DetailSection title="Delivery log">
						<p className="detail-desc">
							Last 100 attempts, refreshing every 5s.
						</p>
						<DeliveryLog subscriptionId={sub.id} />
					</DetailSection>

					<DetailSection title="Dead letter queue">
						<p className="detail-desc">
							Outbox rows that exhausted all retries. Requeue after fixing the
							receiver.
						</p>
						<Dlq subscriptionId={sub.id} />
					</DetailSection>
				</div>
			</div>
		</>
	);
}
