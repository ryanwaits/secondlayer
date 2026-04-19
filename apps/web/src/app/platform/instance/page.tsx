import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { InstanceView } from "./instance-view";

interface TenantSummary {
	slug: string;
	plan: string;
	status: string;
	cpus: number;
	memoryMb: number;
	storageLimitMb: number;
	storageUsedMb: number | null;
	apiUrl: string;
	trialEndsAt: string;
	suspendedAt: string | null;
	createdAt: string;
}

interface TenantRuntime {
	slug: string;
	plan: string;
	containers: Array<{
		name: string;
		state: string;
		cpuUsage?: number;
		memoryUsageBytes?: number;
		memoryLimitBytes?: number;
	}>;
	storageUsedMb?: number;
	storageLimitMb: number;
}

export default async function InstancePage() {
	const session = await getSessionFromCookies();

	let tenant: TenantSummary | null = null;
	let runtime: TenantRuntime | null = null;

	if (session) {
		try {
			const data = await apiRequest<{
				tenant: TenantSummary | null;
				runtime: TenantRuntime | null;
			}>("/api/tenants/me", {
				sessionToken: session,
				tags: ["tenant"],
			});
			tenant = data.tenant;
			runtime = data.runtime ?? null;
		} catch {
			// 404 = no tenant yet, treat as "not provisioned"
		}
	}

	return (
		<>
			<OverviewTopbar page="Instance" showRefresh={false} />
			<div className="settings-scroll">
				<div className="settings-inner">
					<InstanceView
						initialTenant={tenant}
						initialRuntime={runtime}
						sessionToken={session ?? ""}
					/>
				</div>
			</div>
		</>
	);
}
