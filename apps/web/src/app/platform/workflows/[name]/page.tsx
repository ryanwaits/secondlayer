import { BreadcrumbDropdown } from "@/components/console/breadcrumb-dropdown";
import { DetailCodeBlock } from "@/components/console/detail-code-block";
import { DetailSection } from "@/components/console/detail-section";
import { MetaGrid } from "@/components/console/meta-grid";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, apiRequest, getSessionFromCookies } from "@/lib/api";
import type { WorkflowDetail, WorkflowSummary } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkflowDangerZone } from "./danger-zone";
import { ManualTrigger } from "./manual-trigger";
import { WorkflowRunsSection } from "./runs-section";

function statusBadgeClass(status: string) {
	if (status === "active") return "active";
	if (status === "paused") return "syncing";
	return "";
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

export default async function WorkflowDetailPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name } = await params;
	const session = await getSessionFromCookies();
	if (!session) notFound();

	let workflow: WorkflowDetail;
	let allWorkflows: WorkflowSummary[] = [];

	try {
		const [wfResult, listResult] = await Promise.allSettled([
			apiRequest<WorkflowDetail>(`/api/workflows/${name}`, {
				sessionToken: session,
				tags: ["workflows", `workflow-${name}`],
			}),
			apiRequest<{ workflows: WorkflowSummary[] }>("/api/workflows", {
				sessionToken: session,
				tags: ["workflows"],
			}),
		]);

		if (wfResult.status === "rejected") {
			if (wfResult.reason instanceof ApiError && wfResult.reason.status === 404)
				notFound();
			throw wfResult.reason;
		}
		workflow = wfResult.value;
		allWorkflows =
			listResult.status === "fulfilled" ? listResult.value.workflows : [];
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) notFound();
		throw e;
	}

	const dropdownItems = allWorkflows.map((w) => ({
		name: w.name,
		href: `/workflows/${w.name}`,
	}));

	return (
		<>
			<OverviewTopbar
				path={
					<Link
						href="/workflows"
						style={{ color: "inherit", textDecoration: "none" }}
					>
						Workflows
					</Link>
				}
				page={
					<BreadcrumbDropdown
						current={name}
						items={dropdownItems}
						allHref="/workflows"
						allLabel="View all workflows"
					/>
				}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* Metadata cards */}
					<MetaGrid
						items={[
							{
								label: "Status",
								value: (
									<span
										className={`badge ${statusBadgeClass(workflow.status)}`}
									>
										{workflow.status}
									</span>
								),
							},
							{
								label: "Trigger",
								value: workflow.triggerType,
								mono: true,
							},
							{
								label: "Total Runs",
								value: workflow.totalRuns.toLocaleString(),
							},
							{
								label: "Last Run",
								value: formatDate(workflow.lastRunAt),
								mono: true,
							},
							...(workflow.timeoutMs != null
								? [
										{
											label: "Timeout",
											value: `${(workflow.timeoutMs / 1000).toFixed(0)}s`,
											mono: true,
										},
									]
								: []),
							{
								label: "Created",
								value: formatDate(workflow.createdAt),
								mono: true,
							},
						]}
					/>

					{/* Trigger Configuration */}
					<DetailSection title="Trigger Configuration">
						<DetailCodeBlock
							label="TRIGGER"
							code={JSON.stringify(workflow.triggerConfig, null, 2)}
							showCopy
						/>
					</DetailSection>

					{/* Retries */}
					{workflow.retriesConfig && (
						<DetailSection title="Retries">
							<DetailCodeBlock
								label="RETRY CONFIG"
								code={JSON.stringify(workflow.retriesConfig, null, 2)}
								showCopy
							/>
						</DetailSection>
					)}

					{/* Recent Runs */}
					<DetailSection title="Recent Runs">
						<WorkflowRunsSection workflowName={name} />
					</DetailSection>

					{/* Manual Trigger */}
					<DetailSection title="Manual Trigger">
						<ManualTrigger workflowName={name} />
					</DetailSection>

					{/* Danger Zone */}
					<DetailSection title="Danger Zone">
						<WorkflowDangerZone workflowName={name} status={workflow.status} />
					</DetailSection>
				</div>
			</div>
		</>
	);
}
