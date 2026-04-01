import { ActionDropdown } from "@/components/console/action-dropdown";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import {
	type DisplayStatus,
	getDisplayStatus,
} from "@/lib/intelligence/subgraphs";
import type { SubgraphSummary } from "@/lib/types";
import Link from "next/link";
import { SubgraphsEmpty } from "./subgraphs-empty";

const STATUS_ORDER: DisplayStatus[] = [
	"active",
	"syncing",
	"error",
	"reindexing",
];
const STATUS_LABELS: Record<DisplayStatus, string> = {
	active: "Active",
	syncing: "Syncing",
	stalled: "Stalled",
	error: "Error",
	reindexing: "Reindexing",
};
const DOT_COLORS: Record<DisplayStatus, string> = {
	active: "green",
	syncing: "blue",
	stalled: "yellow",
	error: "red",
	reindexing: "blue",
};

function SubgraphRow({
	subgraph,
	displayStatus,
	chainTip,
}: {
	subgraph: SubgraphSummary;
	displayStatus: DisplayStatus;
	chainTip: number | null;
}) {
	const blocksBehind =
		chainTip != null && subgraph.lastProcessedBlock != null
			? chainTip - subgraph.lastProcessedBlock
			: 0;

	return (
		<div className="dash-index-item">
			<Link href={`/subgraphs/${subgraph.name}`} className="dash-index-link">
				<span className="dash-index-label">
					<span className={`dash-activity-dot ${DOT_COLORS[displayStatus]}`} />
					{subgraph.name}
					{displayStatus === "syncing" && (
						<span className="dash-index-hint">catching up</span>
					)}
					{displayStatus === "stalled" && (
						<span className="dash-index-hint">
							{blocksBehind.toLocaleString()} blocks behind
						</span>
					)}
				</span>
				<span className="dash-index-meta">
					<span className={`dash-badge ${displayStatus}`}>
						{STATUS_LABELS[displayStatus]}
					</span>
					{displayStatus === "error"
						? `${subgraph.totalErrors.toLocaleString()} errors`
						: `${subgraph.totalProcessed.toLocaleString()} blocks`}
					{subgraph.lastProcessedBlock != null && (
						<span>#{subgraph.lastProcessedBlock.toLocaleString()}</span>
					)}
				</span>
			</Link>
		</div>
	);
}

export default async function SubgraphsPage() {
	const session = await getSessionFromCookies();
	let subgraphs: SubgraphSummary[] = [];
	let chainTip: number | null = null;

	if (session) {
		const [subgraphsResult, statusResult] = await Promise.allSettled([
			apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", {
				sessionToken: session,
				tags: ["subgraphs"],
			}),
			apiRequest<{ chainTip: number | null }>("/status", {
				sessionToken: session,
				tags: ["status"],
			}),
		]);

		subgraphs =
			subgraphsResult.status === "fulfilled" ? subgraphsResult.value.data : [];
		chainTip =
			statusResult.status === "fulfilled" ? statusResult.value.chainTip : null;
	}

	// Group by display status
	const grouped = new Map<DisplayStatus, SubgraphSummary[]>();
	for (const sg of subgraphs) {
		const status = getDisplayStatus(sg, chainTip);
		const list = grouped.get(status) ?? [];
		list.push(sg);
		grouped.set(status, list);
	}

	const groups = STATUS_ORDER.filter((s) => grouped.has(s)).map((s) => ({
		status: s,
		items: grouped.get(s)!,
	}));

	// Summary line
	const parts = groups.map(
		(g) => `${g.items.length} ${STATUS_LABELS[g.status].toLowerCase()}`,
	);

	return (
		<>
			<div
				className="dash-page-header"
				style={{
					display: "flex",
					alignItems: "flex-start",
					justifyContent: "space-between",
				}}
			>
				<div>
					<h1 className="dash-page-title">Subgraphs</h1>
					{subgraphs.length > 0 && (
						<p className="dash-page-desc">
							{subgraphs.length} subgraph{subgraphs.length !== 1 ? "s" : ""} —{" "}
							{parts.join(", ")}
						</p>
					)}
				</div>
				<ActionDropdown variant="subgraphs" />
			</div>

			<div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
				<Link href="/subgraphs/scaffold" className="scaffold-btn">
					Scaffold from contract
				</Link>
			</div>

			{subgraphs.length === 0 ? (
				<SubgraphsEmpty />
			) : (
				groups.map((group) => (
					<div key={group.status}>
						<div className="dash-section-wrap">
							<hr />
							<h2 className="dash-section-title">
								{STATUS_LABELS[group.status]}
							</h2>
						</div>
						<div className="dash-index-group">
							{group.items.map((sg) => (
								<SubgraphRow
									key={sg.name}
									subgraph={sg}
									displayStatus={group.status}
									chainTip={chainTip}
								/>
							))}
						</div>
					</div>
				))
			)}
		</>
	);
}
