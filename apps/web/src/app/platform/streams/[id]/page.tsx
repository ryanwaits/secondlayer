import { BreadcrumbDropdown } from "@/components/console/breadcrumb-dropdown";
import { DetailCodeBlock } from "@/components/console/detail-code-block";
import { DetailSection } from "@/components/console/detail-section";
import { MetaGrid } from "@/components/console/meta-grid";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, apiRequest, getSessionFromCookies } from "@/lib/api";
import type { Stream } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StreamDangerZone } from "./danger-zone";
import { StreamDeliveries } from "./deliveries-section";
import { OpenInChat } from "./open-in-chat";
import { ReplayForm } from "./replay-form";
import { SigningSecret } from "./signing-secret";

function statusBadgeClass(status: string) {
	if (status === "active") return "active";
	if (status === "paused") return "syncing";
	return "error";
}

function formatDate(dateStr: string | null) {
	if (!dateStr) return "—";
	return new Date(dateStr).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

export default async function StreamDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const session = await getSessionFromCookies();
	if (!session) notFound();

	let stream: Stream;
	let allStreams: Stream[] = [];

	try {
		const [stResult, listResult] = await Promise.allSettled([
			apiRequest<Stream>(`/api/streams/${id}`, {
				sessionToken: session,
				tags: ["streams", `stream-${id}`],
			}),
			apiRequest<{ streams: Stream[]; total: number }>(
				"/api/streams?limit=100&offset=0",
				{ sessionToken: session, tags: ["streams"] },
			),
		]);

		if (stResult.status === "rejected") {
			if (stResult.reason instanceof ApiError && stResult.reason.status === 404)
				notFound();
			throw stResult.reason;
		}
		stream = stResult.value;
		allStreams =
			listResult.status === "fulfilled" ? listResult.value.streams : [];
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) notFound();
		throw e;
	}

	const successRate =
		stream.totalDeliveries > 0
			? (
					((stream.totalDeliveries - stream.failedDeliveries) /
						stream.totalDeliveries) *
					100
				).toFixed(1)
			: "—";

	const dropdownItems = allStreams.map((s) => ({
		name: s.name,
		href: `/streams/${s.id}`,
	}));

	return (
		<>
			<OverviewTopbar
				path={
					<Link
						href="/streams"
						style={{ color: "inherit", textDecoration: "none" }}
					>
						Streams
					</Link>
				}
				page={
					<BreadcrumbDropdown
						current={stream.name}
						items={dropdownItems}
						allHref="/streams"
						allLabel="View all streams"
					/>
				}
				lastUpdated={stream.lastTriggeredAt ?? stream.updatedAt}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* Open in chat CTA */}
					<div
						style={{
							display: "flex",
							justifyContent: "flex-end",
							marginBottom: 12,
						}}
					>
						<OpenInChat streamId={stream.id} streamName={stream.name} />
					</div>

					{/* Metadata cards */}
					<MetaGrid
						items={[
							{ label: "ID", value: stream.id, mono: true },
							{
								label: "Status",
								value: (
									<span className={`badge ${statusBadgeClass(stream.status)}`}>
										{stream.status}
									</span>
								),
							},
							{
								label: "Created",
								value: formatDate(stream.createdAt),
								mono: true,
							},
							{
								label: "Total Deliveries",
								value: stream.totalDeliveries.toLocaleString(),
							},
							{
								label: "Success Rate",
								value: `${successRate}%`,
								valueColor:
									Number(successRate) >= 99
										? "green"
										: Number(successRate) >= 95
											? "yellow"
											: "red",
							},
							{
								label: "Last Triggered",
								value: formatDate(stream.lastTriggeredAt),
								mono: true,
							},
						]}
					/>

					{/* Filters */}
					<DetailSection title="Filters">
						<DetailCodeBlock
							label="ACTIVE FILTERS"
							code={JSON.stringify(stream.filters, null, 2)}
							showCopy
						/>
					</DetailSection>

					{/* Deliveries */}
					<DetailSection title="Deliveries">
						<StreamDeliveries streamId={id} sessionToken={session} />
					</DetailSection>

					{/* Endpoint */}
					<DetailSection title="Endpoint">
						<MetaGrid
							columns="1fr 1fr"
							items={[
								{ label: "Webhook URL", value: stream.endpointUrl, mono: true },
								{
									label: "Signing Secret",
									value: <SigningSecret secret={stream.signingSecret} />,
								},
								{
									label: "Signature Header",
									value: "x-secondlayer-signature",
									mono: true,
								},
								{
									label: "Options",
									value:
										[
											stream.options?.decodeClarityValues &&
												"decodeClarityValues",
											stream.options?.maxRetries != null &&
												`maxRetries: ${stream.options.maxRetries}`,
											stream.options?.timeoutMs != null &&
												`timeout: ${stream.options.timeoutMs}ms`,
										]
											.filter(Boolean)
											.join(" · ") || "defaults",
								},
							]}
						/>
						<div style={{ marginTop: 12 }}>
							<DetailCodeBlock
								label="EXAMPLE PAYLOAD"
								code={JSON.stringify(
									{
										streamId: stream.id,
										streamName: stream.name,
										block: { height: 187421, hash: "0x8a3f..." },
										matches: [
											{
												type: "stx_transfer",
												sender: "SP2J6...K8V3",
												recipient: "SP1WN...R4XY",
												amount: "50000000000",
											},
										],
										deliveredAt: new Date().toISOString(),
									},
									null,
									2,
								)}
								showCopy
							/>
						</div>
					</DetailSection>

					{/* Replay */}
					<DetailSection title="Replay">
						<ReplayForm streamId={stream.id} />
					</DetailSection>

					{/* Danger Zone */}
					<DetailSection title="Danger Zone">
						<StreamDangerZone
							streamId={id}
							streamName={stream.name}
							status={stream.status}
							sessionToken={session}
						/>
					</DetailSection>
				</div>
			</div>
		</>
	);
}
